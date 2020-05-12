import yargs from 'yargs';
import path from 'path';
import async from 'async';
import { spawn } from 'child_process';
import csv from 'async-csv';
import fs, { promises as fsp } from 'fs';
import { log } from './utils.js';
import settings from './settings.js';
import { auth, getWantedItems, searchItem, getStoreSid, getWantedStoreItems } from './api.js';
import { Wanted, WantedStore, Store, getId, getIds } from './data.js';


const fetchWanted = async (wantedId) => {
  log(`Fetch wanted list ${wantedId}...`);
  let wanted = await Wanted.getById(wantedId);
  if (!wanted) {
    wanted = new Wanted({id: wantedId});
    await wanted.save();
  }
  let newItems = await getWantedItems(wanted);
  // TODO: Improve compare
  if (wanted.items.length !== newItems.length) {
    wanted.items = newItems;
    wanted.fetched = null;
    WantedStore.deleteByWanted(wanted);
    await wanted.save();
  }
  return wanted;
};

const getInventory = async (wanted) => {
  const validAfter = new Date(Date.now() - (settings.STORE_CACHE_IN_DAYS * 24 * 60 * 60 * 1000));
  if (wanted.fetched && wanted.fetched > validAfter) {
    log(`Using cache for wanted list...`);
    return;
  }
  // 1. Make a search for each item (first filter)
  let stores = {};
  const siq = async.queue(async (item) => {
    log(`Search item ${getId(item)}... [queued ${siq.length()}]`);
    return await searchItem(item);
  }, settings.CONCURRENT_REQUESTS);
  siq.error(err => { log(err, 'error'); });
  siq.push(wanted.items, (_, newStores) => {Object.assign(stores, newStores);});
  await siq.drain();
  stores = Object.values(stores);

  // DEBUG
  // stores = [stores[0]];

  // 2. Load stores (or updated it)
  stores = await async.map(stores, async store => {
    let db = await Store.getByUsername(store.username);
    if (!db) {
      db = new Store({...store});
      db.id = await getStoreSid(store);
    }
    db.minBuy = store.minBuy;
    await db.save();
    return db;
  });

  // 3.
  const wantedStores = await async.map(stores, async store => {
    let wantedStore = await WantedStore.getByWantedStore(wanted, store);
    if (!wantedStore) {
      wantedStore = new WantedStore({wanted, store});
      await wantedStore.save();
    }
    return wantedStore;
  });

  // 4. Fetch store catalog
  const gscq = async.queue(async ({ wantedStore, page }) => {
    if (wantedStore.fetched && wantedStore.fetched > validAfter) {
      log(`Using cache for store items from:${wantedStore.store.username}... [queued ${gscq.length()}]`);
      return;
    }
    log(`Get store items from:${wantedStore.store.username}/page:${page}... [queued ${gscq.length()}]`);
    const items = await getWantedStoreItems(wanted, wantedStore.store, page);
    if (page === 1) {
      wantedStore.items = items;
    } else {
      wantedStore.items.push(...items);
    }
    if (items.length === 100) {
      gscq.push({ wantedStore, page: page + 1 });
    } else {
      wantedStore.fetched = new Date();
      await wantedStore.save();
    }
  }, settings.CONCURRENT_REQUESTS);
  // gscq.error(err => {throw err});
  gscq.error(err => log(err, 'error'));
  gscq.push(wantedStores.map(wantedStore => ({wantedStore, page: 1})));
  await gscq.drain();

  wanted.fetched = new Date();
  await wanted.save();
};

const optimizeOrder = async (wanted) => {
  const folder = path.join(path.resolve(), '.simplex');
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
  log('Creating exchange files for R...');
  // parameters.csv (S, maxSellers)
  let rows = [{ 'S': 2.00, 'maxSellers': 10 }];
  let content = await csv.stringify(rows, {header: true});
  await fsp.writeFile(path.join(folder, 'parameters.csv'), content);

  // items.csv (id, quantity)
  rows = wanted.items.map(item => ({id: getId(item), quantity: item.quantity}));
  content = await csv.stringify(rows, {header: true});
  await fsp.writeFile(path.join(folder, 'items.csv'), content);

  // availability.csv (id,minBuy,price,quantity,store)
  rows = (await WantedStore.listByWanted(wanted)).reduce((result, wantedStore) => {
    let items = {};
    wantedStore.items.map(item => {
      getIds(item).forEach(id => {
        if (items[id]) {
          items[id].price = ((items[id].price * items[id].quantity) + (item.price * item.quantity)) / (items[id].quantity + item.quantity);
          items[id].quantity = items[id].quantity + item.quantity;
        } else {
          items[id] = {
            store: wantedStore.store.username,
            id,
            minBuy: wantedStore.store.minBuy,
            price: item.price,
            quantity: item.quantity
          };
        }
      });
    });
    return result.concat(Object.values(items));
  }, []);
  content = await csv.stringify(rows, {header: true});
  await fsp.writeFile(path.join(folder, 'availability.csv'), content);

  log('Starting simplex...');
  const simplex = spawn('/usr/local/bin/Rscript', ['simplex.R', '.simplex']);

  simplex.stdout.on('data', (data) => {
    console.log(data);
  });

  simplex.stderr.on('data', (data) => {
    console.error(data);
  });

  await new Promise((resolve, reject) => {
    simplex.on('error', err => {
      console.log(err);
      reject(err);
    });

    simplex.on('exit', (code, a, b) => {
      console.log('Exit', code, a, b);
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(`simplex exited with code ${code}`);
        reject(err);
      }
    })
  });
};


const resolve = async (username, password, wanted) => {
  log('Logging in...');
  const ok = await auth(username, password);
  if (!ok) {
    log('Invalid username or password.', 'error');
    return;
  }
  wanted = await fetchWanted(wanted);
  await getInventory(wanted);
  await optimizeOrder(wanted);
};

const main = async () => {
  const argv = yargs
    .option('username', {alias: 'u'})
    .option('password', {alias: 'p'})
    .option('wanted', {alias: 'w'})
    .demand([ 'username', 'password', 'wanted' ]).argv;
  await resolve(argv.username, argv.password, argv.wanted);
};

export default main;

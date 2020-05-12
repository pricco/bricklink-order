import yargs from 'yargs';
import path from 'path';
import async from 'async';
import util from 'util';
import { exec as realExec } from 'child_process';
import csv from 'async-csv';
import fs, { promises as fsp } from 'fs';
import { log } from './utils.js';
import settings from './settings.js';
import { auth, getWantedItems, searchItem, getStoreSid, getWantedStoreItems } from './api.js';
import { Wanted, WantedStore, Store, getId, getIds } from './data.js';


const exec = util.promisify(realExec);


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
    WantedStore.deleteByWanted(wanted);
    await wanted.save();
  }
  return wanted
};

const getInventory = async (wanted) => {
  // 1. Make a search for each item (first filter)
  let stores = {};
  const siq = async.queue(async (item) => {
    log(`Search item number:${item.number}/color:${item.color | 'NA'}... [queued ${siq.length()}]`);
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
      return wantedStore;
    } else {
      const max = new Date(Date.now() - (settings.STORE_CACHE_IN_DAYS * 24 * 60 * 60 * 1000));
      if (wantedStore.updated && wantedStore.updated < max) {
        wantedStore.updated = null;
        wantedStore.items = [];
        await wantedStore.save();
        return wantedStore;
      } else {
        return wantedStore;
      }
    }
  });

  // 4. Fetch store catalog
  const gscq = async.queue(async ({ wantedStore, page }) => {
    if (wantedStore.updated) {
      log(`Using cache for store items from:${wantedStore.store.username}... [queued ${gscq.length()}]`);
      return;
    }
    log(`Get store items from:${wantedStore.store.username}/page:${page}... [queued ${gscq.length()}]`);
    const items = await getWantedStoreItems(wantedStore.wanted, wantedStore.store, page);
    wantedStore.items.push(...items);
    if (items.length === 100) {
      gscq.push({ wantedStore, page: page + 1 });
    } else {
      wantedStore.updated = new Date();
      await wantedStore.save();
    }
  }, settings.CONCURRENT_REQUESTS);
  // gscq.error(err => {throw err});
  gscq.error(err => log(err, 'error'));
  gscq.push(wantedStores.map(wantedStore => ({wantedStore, page: 1})));
  await gscq.drain();
};

const optimizeOrder = async (wanted) => {
  const folder = path.join(path.resolve(), '.simplex');
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
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

  const { stdout, stderr } = await exec('/usr/local/bin/Rscript simplex.R .simplex');
  console.log(stdout);
  console.log(stderr);
};


const resolve = async (username, password, wanted) => {
  log('Logging in...');
  const ok = await auth(username, password);
  if (!ok) {
    log('Invalid username or password.', 'error');
  }
  wanted = await fetchWanted(wanted);
  await getInventory(wanted);
  wanted = await Wanted.getById(wanted);
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

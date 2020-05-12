import realFetch from 'node-fetch';
import cookieFetch from  'fetch-cookie';
import cheerio from 'cheerio';
import querystring from 'querystring';
import { URLSearchParams } from 'url';

const fetch = cookieFetch(realFetch);

export const auth = async (username, password) => {
  const params = {
    'userid': username,
    'password': password,
    'override': false,
    'keepme_loggedin': true,
    'mid': '16e6d42b7eb00000-15b7942068aea130',
    'pageid': 'MAIN',
  }
  const response = await fetch(
    'https://www.bricklink.com/ajax/renovate/loginandout.ajax',
    {method: 'POST', body: new URLSearchParams(params)}
  );
  const result = await response.json();
  return result.returnCode === 0;
};

export const getWantedItems = async (wanted) => {
  const params = {
    'showStores': '0',
    'storeSort': '1',
    'showIncomplete': '1',
    'showSuperlots': '1',
    'wantedMoreID': wanted.id,
    'pageSize': 10000,
  }
  const response = await fetch(
    'https://www.bricklink.com/ajax/clone/wanted/search2.ajax',
    {method: 'POST', body: new URLSearchParams(params)}
  );
  const result = await response.json();
  return result.results.wantedItems.map(item => ({
    number: item.itemNo,
    color: item.colorID || 'X',
    quantity: item.wantedQty,
    condition: item.wantedNew || 'X',
  }));
};

export const searchItem = async (item) => {
  const params = {
    'a': 'g',
    'colorID': item.color || '',
    'q': item.number,
    'qMin': item.quantity || 1,
    'invNew': !item.condition || item.condition === 'X' ? '*' : item.condition,
    'regionID': '2',
    'saleOff': '0',
    'searchSort': 'P',
    'sellerCountryID': 'US',
    'sellerLoc': 'C',
    'shipCountryID': 'US',
    'shipTo': 'Y',
    'sz': 50, // TODO: more reults, more fetchs later
  };
  // use realFetch (avoid issue with redirect)
  const response = await realFetch(
    'https://www.bricklink.com/searchAdvanced.asp',
    {method: 'POST', body: new URLSearchParams(params)}
  );
  if (!response.ok) {
    throw new Error(`Fetching ${item.number} - ${item.color}.`);
  }
  const $ = cheerio.load(await response.text());
  const results = $('tr.tm').get().reduce((all, elem) => {
    let username = querystring.parse($('td:nth-child(4) a', elem).attr('href').match(/\?(.+)/)[1]).p;
    let minBuy = $('td:nth-child(3) font font', elem).text().match(/Min Buy: (.+)$/)[1];
    minBuy = minBuy === 'None' ? null : parseFloat(minBuy.match(/~US \$(.+)/)[1]);
    all[username] = {username, minBuy};
    return all;
  }, {});
  return results;
};

export const getStoreSid = async (store) => {
  const response = await fetch(`https://store.bricklink.com/${store.username}`);
  const content = await response.text();
  return content.match(/id\:\s+(\d+),/)[1];
};

export const getWantedStoreItems = async (wanted, store, page) => {
  const response = await fetch(`https://store.bricklink.com/ajax/clone/store/searchitems.ajax?sort=2&pgSize=100&wantedMoreArrayID=${wanted.id}&bOnWantedList=1&showHomeItems=0&sid=${store.id}&pg=${page || 1}`);
  const json = await response.json();
  return json.result.groups[0].items.map(item => ({
    number: item.itemNo,
    color: item.colorID || null,
    quantity: item.invQty,
    condition: item.invNew === ' Used' ? 'U' : 'N',
    price: item.rawConvertedPrice,
  }));
};


export default { auth, searchItem, getStoreSid, getWantedItems, getWantedStoreItems };

import mongoose from 'mongoose';
import { log } from './utils.js';


try {
  mongoose.connect(
    'mongodb://localhost/bricklink-order',
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex:true,
    }
  );
} catch (err) {
  log(err, 'error');
};


// Item
const ItemSchema = new mongoose.Schema({
  number: String,
  color: String,
  condition: String,
  quantity: Number,
  price: Number,
});

export const getId = (item) => `${item.number}:${item.color}:${item.condition}`;
export const getIds = (item) => [
  `${item.number}:X:X`,
  `${item.number}:${item.color}:X`,
  `${item.number}:X:${item.condition}`,
  `${item.number}:${item.color}:${item.condition}`,
];

// Wanted
const WantedSchema = new mongoose.Schema({
  id: {type: String, unique: true},
  items: [ItemSchema],
  fetched: Date,
});
WantedSchema.statics.getById = async id => {
  return await Wanted.findOne({ id });
};
export const Wanted = mongoose.model('Wanted', WantedSchema, 'Wanted');


// Store
const StoreSchema = new mongoose.Schema({
  id: {type: String, unique: true},
  username: {type: String, unique: true},
  minBuy: Number,
});
StoreSchema.statics.getById = async id => {
  return await Store.findOne({ id });
};
StoreSchema.statics.getByUsername = async username => {
  return await Store.findOne({ username });
};
export const Store = mongoose.model('Store', StoreSchema, 'Store');


// WantedStore
const WantedStoreSchema = new mongoose.Schema({
  wanted: {type: mongoose.Schema.Types.ObjectId, ref: 'Wanted'},
  store: {type: mongoose.Schema.Types.ObjectId, ref: 'Store'},
  items: [ItemSchema],
  fetched: Date,
});
WantedStoreSchema.statics.getByWantedStore = async (wanted, store) => {
  return await WantedStore.findOne({ wanted, store }).populate('store');
};
WantedStoreSchema.statics.listByWanted = async (wanted) => {
  return await WantedStore.find({ wanted }).populate('store');
};
WantedStoreSchema.statics.deleteByWanted = async wanted => {
  return await WantedStore.deleteMany({ wanted });
};
export const WantedStore = mongoose.model('WantedStore', WantedStoreSchema, 'WantedStore');


export default { Wanted, Store, WantedStore, getId, getIds };

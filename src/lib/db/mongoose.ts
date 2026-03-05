import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __aegisMongooseCache__: MongooseCache | undefined;
}

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }
  return uri;
}

const cache = global.__aegisMongooseCache__ || { conn: null, promise: null };
global.__aegisMongooseCache__ = cache;

export async function connectMongo(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(getMongoUri(), {
      dbName: process.env.MONGODB_DB || "aegis_desk",
      autoIndex: true,
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

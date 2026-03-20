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

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI && process.env.MONGODB_URI.trim().length > 0);
}

export function getMongoDbName(): string {
  return process.env.MONGODB_DB || "aegis_desk";
}

const cache = global.__aegisMongooseCache__ || { conn: null, promise: null };
global.__aegisMongooseCache__ = cache;

export async function connectMongo(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(getMongoUri(), {
      dbName: getMongoDbName(),
      autoIndex: true,
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

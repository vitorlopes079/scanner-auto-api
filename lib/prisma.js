require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

// Reuse one PrismaClient per process. Without this, module re-evaluation
// (e.g. nodemon) can spawn extra clients and exhaust the pool.
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;

module.exports = { prisma };

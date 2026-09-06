-- CreateEnum
CREATE TYPE "language" AS ENUM ('EN', 'SW');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "language" "language";

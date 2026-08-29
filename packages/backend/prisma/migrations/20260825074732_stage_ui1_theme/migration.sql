-- CreateEnum
CREATE TYPE "theme" AS ENUM ('DARK', 'LIGHT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "theme" "theme";

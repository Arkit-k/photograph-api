/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Photo` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Video` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "createdAt",
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "title" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "createdAt",
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "title" SET DEFAULT '';

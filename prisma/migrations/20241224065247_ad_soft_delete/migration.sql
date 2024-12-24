/*
  Warnings:

  - You are about to drop the column `tags` on the `Photo` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `Photo` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `Video` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `Video` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "tags",
DROP COLUMN "url",
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "tags",
DROP COLUMN "url",
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

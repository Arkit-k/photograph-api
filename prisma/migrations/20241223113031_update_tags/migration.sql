/*
  Warnings:

  - The `tags` column on the `Photo` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `tags` column on the `Video` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "tags",
ADD COLUMN     "tags" TEXT[];

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "tags",
ADD COLUMN     "tags" TEXT[];

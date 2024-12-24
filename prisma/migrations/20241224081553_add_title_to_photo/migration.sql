/*
  Warnings:

  - The `title` column on the `Photo` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `title` column on the `Video` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Photo" DROP COLUMN "title",
ADD COLUMN     "title" TEXT[];

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "title",
ADD COLUMN     "title" TEXT[];

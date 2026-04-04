-- CreateTable
CREATE TABLE "ListGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ListGroupMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ListGroupMembers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ListGroupMembers_B_index" ON "_ListGroupMembers"("B");

-- AddForeignKey
ALTER TABLE "ListGroup" ADD CONSTRAINT "ListGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListGroupMembers" ADD CONSTRAINT "_ListGroupMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ListGroupMembers" ADD CONSTRAINT "_ListGroupMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "ListGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

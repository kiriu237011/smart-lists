-- CreateIndex
CREATE INDEX "Item_listId_idx" ON "Item"("listId");

-- CreateIndex
CREATE INDEX "Item_addedById_idx" ON "Item"("addedById");

-- CreateIndex
CREATE INDEX "List_ownerId_idx" ON "List"("ownerId");

-- CreateIndex
CREATE INDEX "ListGroup_userId_idx" ON "ListGroup"("userId");

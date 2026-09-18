import { createChatOperationsShared, type ChatOperationsDeps } from './chatOperationsShared'
import { createChatDraftOperations } from './chatDraftOperations'
import { createChatRunOperations } from './chatRunOperations'
import { createChatMessageOperations } from './chatMessageOperations'
import { createChatBranchOperations } from './chatBranchOperations'

export function createChatOperations(deps: ChatOperationsDeps) {
  const shared = createChatOperationsShared(deps)
  const draftOperations = createChatDraftOperations(shared)
  const runOperations = createChatRunOperations(shared, draftOperations)
  const messageOperations = createChatMessageOperations(shared)
  const branchOperations = createChatBranchOperations(shared)

  return {
    pickDraftImages: draftOperations.pickDraftImages,
    addDraftImagesFromFiles: draftOperations.addDraftImagesFromFiles,
    addDraftFilesFromFiles: draftOperations.addDraftFilesFromFiles,
    sendChat: runOperations.sendChat,
    sendGroupChat: runOperations.sendGroupChat,
    stopSending: runOperations.stopSending,
    regenerateAssistantMessage: runOperations.regenerateAssistantMessage,
    regenerateGroupAssistantMessage: runOperations.regenerateGroupAssistantMessage,
    replyFromUserMessage: runOperations.replyFromUserMessage,
    replyFromUserMessageInGroup: runOperations.replyFromUserMessageInGroup,
    createParallelBranchFromAssistantMessage: branchOperations.createParallelBranchFromAssistantMessage,
    switchBranchByAssistantSibling: branchOperations.switchBranchByAssistantSibling,
    setActiveBranch: branchOperations.setActiveBranch,
    submitToolConfirmationDecision: messageOperations.submitToolConfirmationDecision,
    deleteMessage: messageOperations.deleteMessage,
    deleteMessageSubtree: messageOperations.deleteMessageSubtree,
    editMessage: messageOperations.editMessage,
    editMessageBlock: messageOperations.editMessageBlock,
    deleteMessageBlock: messageOperations.deleteMessageBlock,
  }
}

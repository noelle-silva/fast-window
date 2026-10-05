import * as React from 'react'
import { getRefsByFolderId, type FavoriteFolder, type HyperCortexFavoritesDocV1 } from '../../favorites'
import { FolderCard } from '../index-cards/FolderCard'

type Props = {
  doc: HyperCortexFavoritesDocV1
  folder: FavoriteFolder
}

export function FolderSuggestionCard(props: Props): React.ReactNode {
  const { doc, folder } = props
  const refCount = getRefsByFolderId(doc, folder.id).length
  return <FolderCard folderId={folder.id} title={folder.title} description={folder.description} refCount={refCount} disabled onClick={() => {}} />
}

import type * as React from 'react'
import type { TaskBoard } from '../types'

type TaskBoardCardProps = {
  board: TaskBoard
  onOpen: () => void
}

export function TaskBoardCard({ board, onOpen }: TaskBoardCardProps) {
  return (
    <button type="button" className="tm-board-card" style={{ '--board-accent': board.accent } as React.CSSProperties} onClick={onOpen}>
      <span className="tm-board-glow" aria-hidden="true" />
      <span className="tm-board-title">{board.title}</span>
      <span className="tm-board-description">{board.description || '没有描述'}</span>
      <span className="tm-board-count">{board.tasks.length} 条任务</span>
    </button>
  )
}

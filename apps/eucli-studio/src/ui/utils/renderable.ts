import * as React from 'react'

export const isRenderableNode = (node: React.ReactNode): node is Exclude<React.ReactNode, null> => node !== null

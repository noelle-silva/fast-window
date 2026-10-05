import * as React from 'react'
import { Box } from '@mui/material'
import type { NoteSearchFaceKind, SearchCatalog, SearchFieldOption } from '../gateway/types'
import { toggleInList, type NoteSearchFilters } from './quickSearchFilters'
import { DateRangeInputs, FilterChip, FilterRow, filterInputSx } from './QuickSearchFilterControls'

export function NoteFilterPanel(props: {
  catalog: SearchCatalog
  filters: NoteSearchFilters
  folders: { id: string; title: string }[]
  onChange: (next: NoteSearchFilters) => void
}): React.ReactNode {
  const { catalog, filters, folders, onChange } = props
  return (
    <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75, borderTop: '1px solid rgba(0,0,0,.06)' }}>
      <FilterRow label="维度">
        {catalog.noteFields.map((field: SearchFieldOption) => (
          <FilterChip
            key={field.key}
            label={field.label}
            active={filters.fields.includes(field.key)}
            onClick={() => onChange({ ...filters, fields: toggleInList(filters.fields, field.key) })}
          />
        ))}
      </FilterRow>
      {catalog.noteFaceKinds.length ? (
        <FilterRow label="面类型">
          {catalog.noteFaceKinds.map((face: NoteSearchFaceKind) => (
            <FilterChip
              key={face.kind}
              label={face.label}
              active={filters.faceKinds.includes(face.kind)}
              onClick={() => onChange({ ...filters, faceKinds: toggleInList(filters.faceKinds, face.kind) })}
            />
          ))}
        </FilterRow>
      ) : null}
      <FilterRow label="收藏夹">
        <Box
          component="select"
          value={filters.folderId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange({ ...filters, folderId: e.target.value })}
          sx={{ ...filterInputSx, minWidth: 120 }}
        >
          <option value="">全部</option>
          {folders.map(folder => (
            <option key={folder.id} value={folder.id}>
              {folder.title}
            </option>
          ))}
        </Box>
      </FilterRow>
      <FilterRow label="时间">
        <DateRangeInputs
          from={filters.updatedFromMs}
          to={filters.updatedToMs}
          onChange={(from, to) => onChange({ ...filters, updatedFromMs: from, updatedToMs: to })}
        />
      </FilterRow>
    </Box>
  )
}

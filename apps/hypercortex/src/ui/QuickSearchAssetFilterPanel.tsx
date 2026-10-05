import * as React from 'react'
import { Box } from '@mui/material'
import type { SearchCatalog, SearchFieldOption, SearchKindOption } from '../gateway/types'
import { toggleInList, type AssetSearchFilters } from './quickSearchFilters'
import { DateRangeInputs, FilterChip, FilterRow, SizeRangeInputs } from './QuickSearchFilterControls'

export function AssetFilterPanel(props: {
  catalog: SearchCatalog
  filters: AssetSearchFilters
  onChange: (next: AssetSearchFilters) => void
}): React.ReactNode {
  const { catalog, filters, onChange } = props
  return (
    <Box sx={{ px: 1.25, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75, borderTop: '1px solid rgba(0,0,0,.06)' }}>
      <FilterRow label="维度">
        {catalog.assetFields.map((field: SearchFieldOption) => (
          <FilterChip
            key={field.key}
            label={field.label}
            active={filters.fields.includes(field.key)}
            onClick={() => onChange({ ...filters, fields: toggleInList(filters.fields, field.key) })}
          />
        ))}
      </FilterRow>
      <FilterRow label="类型">
        <FilterChip label="全部" active={!filters.kind} onClick={() => onChange({ ...filters, kind: '' })} />
        {catalog.assetKinds.map((kind: SearchKindOption) => (
          <FilterChip
            key={kind.kind}
            label={kind.label}
            active={filters.kind === kind.kind}
            onClick={() => onChange({ ...filters, kind: filters.kind === kind.kind ? '' : kind.kind })}
          />
        ))}
      </FilterRow>
      <FilterRow label="大小">
        <SizeRangeInputs
          from={filters.sizeFrom}
          to={filters.sizeTo}
          onChange={(from, to) => onChange({ ...filters, sizeFrom: from, sizeTo: to })}
        />
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

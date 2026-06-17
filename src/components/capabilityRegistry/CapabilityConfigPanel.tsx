import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import type { AppCapabilityConfigField, AppCapabilityOption, AppCapabilityDescriptor, RegisteredApp } from '../../apps/types'
import { commandCapabilityConfigFieldsState, commandCapabilityConfigState, queryAppCapabilityOptions } from '../../apps/appCapabilities'
import { hostButtonSx, hostTextFieldSx } from '../hostUiStyles'

type CapabilityConfigPanelProps = {
  app: RegisteredApp
  command: AppCapabilityDescriptor
  registered: boolean
  onSave: (config: Record<string, unknown>) => void | Promise<void>
}

type OptionState = Record<string, AppCapabilityOption[]>
type LoadingState = Record<string, boolean>

function fieldSignature(fields: AppCapabilityConfigField[]) {
  return fields.map(field => `${field.id}:${field.optionSource}`).join('|')
}

function configComplete(fields: AppCapabilityConfigField[], config: Record<string, unknown>) {
  return fields.every(field => String(config[field.id] ?? '').trim())
}

export default function CapabilityConfigPanel({ app, command, registered, onSave }: CapabilityConfigPanelProps) {
  const configFieldsState = useMemo(() => commandCapabilityConfigFieldsState(command), [command])
  const configState = useMemo(() => commandCapabilityConfigState(command), [command])
  const { fields, error: configFieldsError } = configFieldsState
  const { config: initialConfig, error: configError } = configState
  const [draft, setDraft] = useState<Record<string, unknown>>(() => initialConfig)
  const [options, setOptions] = useState<OptionState>({})
  const [loading, setLoading] = useState<LoadingState>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const signature = fieldSignature(fields)

  useEffect(() => {
    setDraft(initialConfig)
  }, [app.id, command.id, initialConfig])

  useEffect(() => {
    if (!fields.length || configError) return
    let cancelled = false
    const loadFieldOptions = async (field: AppCapabilityConfigField) => {
      setLoading(prev => ({ ...prev, [field.id]: true }))
      try {
        const nextOptions = await queryAppCapabilityOptions({
          app,
          capabilityId: command.id,
          optionSource: field.optionSource,
          config: draft,
        })
        if (cancelled) return
        setOptions(prev => ({ ...prev, [field.id]: nextOptions }))
        setError('')
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message || err || '读取配置选项失败'))
      } finally {
        if (!cancelled) setLoading(prev => ({ ...prev, [field.id]: false }))
      }
    }
    for (const field of fields) void loadFieldOptions(field)
    return () => { cancelled = true }
  }, [app.id, command.id, signature, JSON.stringify(draft), configError])

  if (configError) {
    return (
      <Box sx={{ mt: 1 }}>
        <Alert severity="error" sx={{ borderRadius: 2 }}>{configError}</Alert>
      </Box>
    )
  }

  if (configFieldsError) {
    return (
      <Box sx={{ mt: 1 }}>
        <Alert severity="error" sx={{ borderRadius: 2 }}>{configFieldsError}</Alert>
      </Box>
    )
  }

  if (!fields.length) return null

  const saveConfig = async () => {
    setSaving(true)
    try {
      await onSave({ ...draft })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {error ? <Alert severity="warning" sx={{ borderRadius: 2 }}>{error}</Alert> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1 }}>
        {fields.map(field => {
          const fieldOptions = options[field.id] || []
          const busy = loading[field.id] === true
          return (
            <FormControl key={field.id} size="small" sx={hostTextFieldSx}>
              <InputLabel>{field.label}</InputLabel>
              <Select
                label={field.label}
                value={String(draft[field.id] ?? '')}
                onChange={event => setDraft(prev => ({ ...prev, [field.id]: event.target.value }))}
                endAdornment={busy ? <CircularProgress size={14} sx={{ mr: 2 }} /> : undefined}
              >
                {fieldOptions.map(option => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant={registered ? 'outlined' : 'contained'}
          sx={hostButtonSx}
          disabled={saving || !configComplete(fields, draft)}
          onClick={() => void saveConfig()}
        >
          {registered ? '保存配置' : '选取并保存配置'}
        </Button>
      </Box>
    </Box>
  )
}

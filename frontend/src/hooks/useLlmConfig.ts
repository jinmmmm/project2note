import { useAppStore } from '@/store/appStore'

export function useLlmConfig() {
  const providers = useAppStore((s) => s.providers)
  const llmDefaults = useAppStore((s) => s.llmDefaults)
  const userLLMConfig = useAppStore((s) => s.userLLMConfig)

  const preferredProviderId = llmDefaults?.provider_id
  const defaultProviderId =
    providers.find((p) => p.id === preferredProviderId)?.id
    ?? providers[0]?.id
    ?? preferredProviderId
    ?? ''
  const defaultModelName = llmDefaults?.model_name ?? ''

  const customEnabled = userLLMConfig.mode === 'custom'
  const noteApiKey = customEnabled ? userLLMConfig.note_api_key.trim() : ''
  const noteBaseUrl = customEnabled ? userLLMConfig.note_base_url.trim() : ''
  const modelName = customEnabled ? userLLMConfig.note_model_name.trim() : defaultModelName
  const visionApiKey = customEnabled
    ? (userLLMConfig.vision_reuse_note_key ? noteApiKey : userLLMConfig.vision_api_key.trim())
    : ''
  const visionBaseUrl = customEnabled
    ? (userLLMConfig.vision_reuse_note_key ? noteBaseUrl : userLLMConfig.vision_base_url.trim())
    : ''
  const visionModelName = customEnabled ? userLLMConfig.vision_model_name.trim() : (llmDefaults?.vision_model_name ?? '')

  const requestPayload = customEnabled
    ? {
        user_note_api_key: noteApiKey,
        user_note_base_url: noteBaseUrl,
        user_note_model_name: modelName,
        user_vision_api_key: visionApiKey || undefined,
        user_vision_base_url: visionBaseUrl || undefined,
        user_vision_model_name: visionModelName || undefined,
      }
    : {}

  return {
    providerId: defaultProviderId,
    modelName,
    llmDefaults,
    userLLMConfig,
    customEnabled,
    noteApiKey,
    noteBaseUrl,
    visionApiKey,
    visionBaseUrl,
    visionModelName,
    requestPayload,
  }
}

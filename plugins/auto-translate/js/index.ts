type TranslationResult = {
	translatedText: string
	detectedLanguage?: string
}

type DiscordMessage = {
	id?: string
	channel_id?: string
	content?: string
	[key: string]: unknown
}

type FluxPayload = {
	type: string
	message?: DiscordMessage
	messages?: DiscordMessage[]
	[key: string]: unknown
}

const TAG = '[AutoTranslate]'
const INCOMING_LANGUAGE = 'ru'
const OUTGOING_LANGUAGE = 'en'
const TRANSLATION_MARKER = '\n> 🇷🇺 '
const REQUEST_TIMEOUT_MS = 10_000
const MAX_TEXT_LENGTH = 4_000
const MAX_CACHE_ENTRIES = 500

const cache = new Map<string, TranslationResult>()
const inFlight = new Map<string, Promise<TranslationResult>>()
const pendingIncoming = new Set<string>()

function log(...args: unknown[]) {
	console.log(TAG, ...args)
}

function warn(...args: unknown[]) {
	console.warn(TAG, ...args)
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function isMostlyRussian(text: string): boolean {
	const letters = text.match(/[A-Za-zА-Яа-яЁё]/g) ?? []
	if (letters.length === 0) return false

	const cyrillic = letters.filter(character =>
		/[А-Яа-яЁё]/.test(character),
	).length
	return cyrillic / letters.length >= 0.55
}

function shouldTranslateIncoming(text: string): boolean {
	const normalized = normalizeText(text)
	return (
		normalized.length >= 2 &&
		normalized.length <= MAX_TEXT_LENGTH &&
		!isMostlyRussian(normalized) &&
		!text.includes(TRANSLATION_MARKER)
	)
}

function shouldTranslateOutgoing(text: string): boolean {
	const normalized = normalizeText(text)
	return (
		normalized.length >= 2 &&
		normalized.length <= MAX_TEXT_LENGTH &&
		isMostlyRussian(normalized)
	)
}

async function requestTranslation(
	text: string,
	targetLanguage: string,
): Promise<TranslationResult> {
	const normalized = normalizeText(text)
	const key = `${targetLanguage}:${normalized}`
	const cached = cache.get(key)
	if (cached) return cached

	const pending = inFlight.get(key)
	if (pending) return pending

	const request = (async () => {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

		try {
			const url =
				'https://translate.googleapis.com/translate_a/single' +
				`?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}` +
				`&dt=t&q=${encodeURIComponent(normalized)}`
			const response = await fetch(url, {
				headers: { Accept: 'application/json,text/plain,*/*' },
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`Translate HTTP ${response.status}`)
			}

			const data = await response.json()
			const translatedText = Array.isArray(data?.[0])
				? data[0]
						.map((part: unknown) =>
							Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '',
						)
						.join('')
						.trim()
				: ''

			if (!translatedText) {
				throw new Error('Translation response was empty')
			}

			const result = {
				translatedText,
				detectedLanguage: typeof data?.[2] === 'string' ? data[2] : undefined,
			}

			cache.set(key, result)
			while (cache.size > MAX_CACHE_ENTRIES) {
				const oldest = cache.keys().next().value
				if (oldest === undefined) break
				cache.delete(oldest)
			}

			return result
		} finally {
			clearTimeout(timeout)
		}
	})().finally(() => inFlight.delete(key))

	inFlight.set(key, request)
	return request
}

function collectMessages(payload: FluxPayload): DiscordMessage[] {
	const messages: DiscordMessage[] = []
	if (payload.message) messages.push(payload.message)
	if (Array.isArray(payload.messages)) messages.push(...payload.messages)
	return messages
}

function installIncomingTranslation(api: any) {
	const { Dispatcher } = api.unscoped.discord.common.flux
	const { onAnyFluxEventDispatched } = api.unscoped.discord.flux

	const unsubscribe = onAnyFluxEventDispatched((payload: FluxPayload) => {
		if (!payload.type.includes('MESSAGE')) return payload

		for (const message of collectMessages(payload)) {
			const id = message.id
			const content = message.content
			if (!id || !content || !shouldTranslateIncoming(content)) continue
			if (pendingIncoming.has(id)) continue

			pendingIncoming.add(id)
			void requestTranslation(content, INCOMING_LANGUAGE)
				.then(result => {
					if (result.detectedLanguage?.toLowerCase().startsWith('ru')) return
					if (normalizeText(result.translatedText) === normalizeText(content)) {
						return
					}

					const translatedMessage = {
						...message,
						content: `${content}${TRANSLATION_MARKER}${result.translatedText}`,
					}

					return Dispatcher.dispatch({
						type: 'MESSAGE_UPDATE',
						message: translatedMessage,
					})
				})
				.catch(error => warn(`incoming translation failed for ${id}`, error))
				.finally(() => pendingIncoming.delete(id))
		}

		return payload
	})

	api.cleanup(unsubscribe)
	log('incoming MESSAGE_* translation installed')
}

function installOutgoingTranslation(api: any) {
	const { getModules, filters } = api.unscoped.modules.finders
	const { instead } = api.unscoped.patcher

	const stopFinding = getModules(
		filters.withProps('sendMessage'),
		(module: Record<string, unknown>, moduleId: number) => {
			if (typeof module.sendMessage !== 'function') return

			const unpatch = instead(
				module as Record<string, (...args: any[]) => any>,
				'sendMessage',
				async (args: any[], original: (...args: any[]) => any) => {
					const draft = args[1]
					const content = draft?.content
					if (
						typeof content !== 'string' ||
						!shouldTranslateOutgoing(content)
					) {
						return original(...args)
					}

					try {
						const result = await requestTranslation(content, OUTGOING_LANGUAGE)
						if (result.detectedLanguage?.toLowerCase().startsWith('en')) {
							return original(...args)
						}

						const translatedDraft = {
							...draft,
							content: result.translatedText,
						}
						const translatedArgs = [...args]
						translatedArgs[1] = translatedDraft
						log('outgoing message translated ru -> en')
						return original(...translatedArgs)
					} catch (error) {
						warn('outgoing translation failed; sending original text', error)
						return original(...args)
					}
				},
			)

			api.cleanup(unpatch)
			log(`patched sendMessage in Metro module ${moduleId}`)
		},
		{ max: 1 },
	)

	api.cleanup(stopFinding)
	log('waiting for Discord sendMessage module')
}

export default plugin({
	start(api) {
		log('starting')
		installIncomingTranslation(api)
		installOutgoingTranslation(api)
	},

	stop() {
		pendingIncoming.clear()
		inFlight.clear()
		cache.clear()
		log('stopped')
	},
})

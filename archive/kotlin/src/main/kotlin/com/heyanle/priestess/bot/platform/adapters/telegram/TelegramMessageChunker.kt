package com.heyanle.priestess.bot.platform.adapters.telegram

/**
 * 按 Unicode 码点拆分消息，避免把 UTF-16 代理对的一半发送给 Telegram。
 *
 * 优先在段落、换行或空白处断开，以尽量保留 Markdown 块结构；遇到超长的单行内容时，
 * 才在安全的码点边界强制拆分。
 */
internal object TelegramMessageChunker {
    fun split(text: String, maxCodePoints: Int): List<String> {
        require(maxCodePoints > 0) { "maxCodePoints must be positive" }
        if (text.codePointCount(0, text.length) <= maxCodePoints) return listOf(text)

        val chunks = mutableListOf<String>()
        var start = 0
        while (start < text.length) {
            var end = start
            var count = 0
            while (end < text.length && count < maxCodePoints) {
                end += Character.charCount(text.codePointAt(end))
                count++
            }

            if (end == text.length) {
                chunks += text.substring(start)
                break
            }

            val splitAt = preferredBreak(text, start, end)
            chunks += text.substring(start, splitAt)
            start = splitAt
        }
        return chunks
    }

    private fun preferredBreak(text: String, start: Int, end: Int): Int {
        val candidates = listOf("\n\n", "\n", " ", "\t")
        for (separator in candidates) {
            val index = text.lastIndexOf(separator, end - 1)
            if (index >= start && index + separator.length <= end) return index + separator.length
        }
        return end
    }
}

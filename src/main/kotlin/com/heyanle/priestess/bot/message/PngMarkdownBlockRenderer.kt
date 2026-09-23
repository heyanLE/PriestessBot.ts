package com.heyanle.priestess.bot.message

import com.heyanle.priestess.bot.platform.MessageComponent
import java.awt.Color
import java.awt.Font
import java.awt.FontMetrics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import javax.imageio.ImageIO

/** Local, headless rendering with bounded canvas sizes and pagination in both dimensions. */
class PngMarkdownBlockRenderer(
    private val width: Int = 1200,
    private val maxHeight: Int = 1500,
    private val fontSize: Int = 22,
    private val maxPages: Int = 32,
    private val maxCharacters: Int = 200_000,
) : MarkdownBlockRenderer {
    init {
        require(width in 320..2048)
        require(maxHeight in 200..2048)
        require(fontSize in 12..40)
        require(maxPages in 1..64)
        require(maxCharacters in 1..1_000_000)
    }

    private val font = Font(Font.MONOSPACED, Font.PLAIN, fontSize)

    override fun render(block: MarkdownVisualBlock): List<MessageComponent.Image> {
        require(block.plainText().length <= maxCharacters) { "Visual block exceeds character budget" }
        val measurement = BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB)
        val graphics = measurement.createGraphics()
        try {
            configure(graphics)
            val metrics = graphics.fontMetrics
            val pages = when (block) {
                is MarkdownVisualBlock.Code -> codePages(block, metrics)
                is MarkdownVisualBlock.Table -> tablePages(block, metrics)
            }
            require(pages.size <= maxPages) { "Visual block exceeds image budget" }
            return pages.map { page -> encode(page, metrics) }
        } finally {
            graphics.dispose()
            measurement.flush()
        }
    }

    private data class Row(val cells: List<String>, val header: Boolean = false)
    private data class Page(val title: String, val widths: List<Int>, val rows: List<Row>, val table: Boolean)

    private fun codePages(block: MarkdownVisualBlock.Code, metrics: FontMetrics): List<Page> {
        val lineWidth = width - PADDING * 2
        val lines = block.source.removeSuffix("\n").split('\n').flatMap { wrap(it, lineWidth, metrics) }
        val rowsPerPage = rowsPerPage(metrics)
        require((lines.size + rowsPerPage - 1) / rowsPerPage <= maxPages) { "Code exceeds image budget" }
        return lines.chunked(rowsPerPage).map { linesOnPage ->
            Page(block.language.lineSequence().firstOrNull().orEmpty().take(80).ifBlank { "Code" },
                listOf(lineWidth), linesOnPage.map { Row(listOf(it)) }, false)
        }
    }

    private fun tablePages(block: MarkdownVisualBlock.Table, metrics: FontMetrics): List<Page> {
        require(block.rows.isNotEmpty()) { "Table is empty" }
        val columns = block.rows.maxOf { it.size }
        require(columns > 0)
        val maxColumns = maxOf(1, (width - PADDING * 2) / MIN_COLUMN_WIDTH)
        val pages = mutableListOf<Page>()
        // Very wide tables are split into groups of consecutive columns instead of shrinking
        // text until illegible. Each group retains the matching header and all data rows.
        for (columnStart in 0 until columns step maxColumns) {
            val columnEnd = minOf(columns, columnStart + maxColumns)
            val count = columnEnd - columnStart
            val cellWidth = (width - PADDING * 2) / count
            val widths = List(count) { cellWidth }
            fun visualRows(row: List<String>, header: Boolean): List<Row> {
                val cells = (columnStart until columnEnd).map { col ->
                    row.getOrElse(col) { "" }.split('\n').flatMap { wrap(it, cellWidth - CELL_PADDING * 2, metrics) }
                }
                return List(cells.maxOf { it.size }) { line ->
                    Row(cells.map { it.getOrElse(line) { "" } }, header)
                }
            }
            val header = visualRows(block.rows.first(), true)
            val capacity = rowsPerPage(metrics)
            val title = if (columns > maxColumns) "Table · columns ${columnStart + 1}–$columnEnd" else "Table"
            var rows = mutableListOf<Row>()
            fun finishPage() {
                if (rows.isNotEmpty()) {
                    pages += Page(title, widths, rows.toList(), true)
                    require(pages.size <= maxPages) { "Table exceeds image budget" }
                    rows = mutableListOf()
                }
            }
            val repeatHeader = header.size <= capacity / 3
            (listOf(header) + block.rows.drop(1).map { visualRows(it, false) }).forEach { rowLines ->
                for (line in rowLines) {
                    if (rows.size == capacity) {
                        finishPage()
                        if (repeatHeader && !line.header) rows.addAll(header)
                    }
                    rows += line
                }
            }
            finishPage()
        }
        return pages
    }

    private fun rowsPerPage(metrics: FontMetrics): Int =
        maxOf(1, (maxHeight - PADDING * 2 - TITLE_HEIGHT) / (metrics.height + LINE_GAP))

    /** Wraps at Unicode code point boundaries, preserving spaces and every source character. */
    internal fun wrap(value: String, availableWidth: Int, metrics: FontMetrics): List<String> {
        if (value.isEmpty()) return listOf("")
        val result = mutableListOf<String>()
        val current = StringBuilder()
        var currentWidth = 0
        var offset = 0
        while (offset < value.length) {
            val point = value.codePointAt(offset)
            val glyph = if (point == '\t'.code) "    " else String(Character.toChars(point))
            val glyphWidth = metrics.stringWidth(glyph)
            if (current.isNotEmpty() && currentWidth + glyphWidth > availableWidth) {
                result += current.toString()
                current.setLength(0)
                currentWidth = 0
            }
            current.append(glyph)
            currentWidth += glyphWidth
            offset += Character.charCount(point)
        }
        if (current.isNotEmpty()) result += current.toString()
        return result
    }

    private fun encode(page: Page, metrics: FontMetrics): MessageComponent.Image {
        val lineHeight = metrics.height + LINE_GAP
        val height = PADDING * 2 + TITLE_HEIGHT + maxOf(1, page.rows.size) * lineHeight
        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
        val graphics = image.createGraphics()
        try {
            configure(graphics)
            graphics.color = BACKGROUND
            graphics.fillRect(0, 0, width, height)
            graphics.color = SECONDARY
            graphics.drawString(page.title, PADDING, PADDING + metrics.ascent)
            var y = PADDING + TITLE_HEIGHT
            page.rows.forEach { row ->
                var x = PADDING
                row.cells.forEachIndexed { index, cell ->
                    val cellWidth = page.widths[index]
                    if (page.table) {
                        graphics.color = if (row.header) HEADER_BACKGROUND else Color.WHITE
                        graphics.fillRect(x, y, cellWidth, lineHeight)
                        graphics.color = BORDER
                        graphics.drawRect(x, y, cellWidth, lineHeight)
                    }
                    graphics.color = FOREGROUND
                    graphics.drawString(cell, x + if (page.table) CELL_PADDING else 0, y + metrics.ascent + LINE_GAP / 2)
                    x += cellWidth
                }
                y += lineHeight
            }
            val output = ByteArrayOutputStream()
            check(ImageIO.write(image, "png", output)) { "No PNG encoder available" }
            return MessageComponent.Image("base64://${Base64.getEncoder().encodeToString(output.toByteArray())}")
        } finally {
            graphics.dispose()
            image.flush()
        }
    }

    private fun configure(graphics: Graphics2D) {
        graphics.font = font
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
        graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
    }

    private companion object {
        const val PADDING = 24
        const val CELL_PADDING = 10
        const val TITLE_HEIGHT = 42
        const val LINE_GAP = 8
        const val MIN_COLUMN_WIDTH = 180
        val BACKGROUND = Color(248, 250, 252)
        val HEADER_BACKGROUND = Color(226, 232, 240)
        val BORDER = Color(203, 213, 225)
        val FOREGROUND = Color(15, 23, 42)
        val SECONDARY = Color(71, 85, 105)
    }
}

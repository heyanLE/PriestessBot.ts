package com.heyanle.priestess.bot.platform.adapters.weixin

import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import javax.imageio.ImageIO

internal object WeixinQrRenderer {
    fun pngDataUrl(content: String, size: Int = 320): String {
        require(content.isNotBlank()) { "Weixin QR content must not be blank" }
        require(size in 128..1_024) { "Weixin QR image size must be between 128 and 1024" }
        val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
        val image = BufferedImage(size, size, BufferedImage.TYPE_INT_RGB)
        for (y in 0 until size) {
            for (x in 0 until size) {
                image.setRGB(x, y, if (matrix[x, y]) BLACK else WHITE)
            }
        }
        val bytes = ByteArrayOutputStream().use { output ->
            check(ImageIO.write(image, "png", output)) { "PNG writer is unavailable" }
            output.toByteArray()
        }
        return "data:image/png;base64,${Base64.getEncoder().encodeToString(bytes)}"
    }

    private const val BLACK = 0x000000
    private const val WHITE = 0xFFFFFF
}

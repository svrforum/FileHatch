import { useEffect, useState } from 'react'

interface LocalQRCodeProps {
  value: string
  size?: number
  alt: string
}

function LocalQRCode({ value, size = 200, alt }: LocalQRCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    let cancelled = false

    setDataUrl(null)
    setHasError(false)

    const generateQRCode = async () => {
      try {
        const { toDataURL } = await import('qrcode')
        const nextDataUrl = await toDataURL(value, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: size,
        })

        if (!cancelled) {
          setDataUrl(nextDataUrl)
        }
      } catch (error) {
        console.error('QR 코드 생성 실패:', error)
        if (!cancelled) {
          setHasError(true)
        }
      }
    }

    void generateQRCode()

    return () => {
      cancelled = true
    }
  }, [size, value])

  if (hasError) {
    return <p role="alert">QR 코드를 생성하지 못했습니다. 아래 비밀키를 수동으로 입력해 주세요.</p>
  }

  if (!dataUrl) {
    return <p role="status">QR 코드를 생성하는 중입니다.</p>
  }

  return <img src={dataUrl} width={size} height={size} alt={alt} />
}

export default LocalQRCode

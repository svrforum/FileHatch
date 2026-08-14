import { useEffect, useId, useState } from 'react'
import './PasswordField.css'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  minLength?: number
  maxLength?: number
  autoComplete?: 'current-password' | 'new-password'
  autoFocus?: boolean
  disabled?: boolean
}

function PasswordField({
  label,
  value,
  onChange,
  required = false,
  placeholder,
  minLength,
  maxLength,
  autoComplete = 'new-password',
  autoFocus = false,
  disabled = false,
}: PasswordFieldProps) {
  const inputId = useId()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!value) setVisible(false)
  }, [value])

  return (
    <div className="password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field-control">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-visibility-button"
          aria-label={`${label} ${visible ? '숨기기' : '보기'}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
        >
          {visible ? '숨기기' : '보기'}
        </button>
      </div>
    </div>
  )
}

export default PasswordField

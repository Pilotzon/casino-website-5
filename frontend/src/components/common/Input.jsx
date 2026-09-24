import styles from './Input.module.css';

function Input({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  error,
  icon,
  suffix,
  min,
  max,
  step,
  className = ''
}) {
  return (
    <div className={`${styles.inputGroup} ${className}`}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={`${styles.inputWrapper} ${error ? styles.error : ''} ${disabled ? styles.disabled : ''}`}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          className={styles.input}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}

export default Input;
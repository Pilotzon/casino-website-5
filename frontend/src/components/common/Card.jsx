import styles from './Card.module.css';

function Card({ 
  children, 
  title, 
  className = '',
  noPadding = false,
  variant = 'default' 
}) {
  return (
    <div className={`${styles.card} ${styles[variant]} ${className}`}>
      {title && (
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
        </div>
      )}
      <div className={`${styles.content} ${noPadding ? styles.noPadding : ''}`}>
        {children}
      </div>
    </div>
  );
}

export default Card;
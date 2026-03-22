import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface AmoAvatarProps {
  isSpeaking?: boolean;
  isListening?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  persona?: 'amo' | 'keri';
}

const AmoAvatar: React.FC<AmoAvatarProps> = ({ 
  isSpeaking = false, 
  isListening = false, 
  size = 'md',
  persona = 'amo'
}) => {
  const sizeClasses = {
    sm: 'w-12 h-12',
    md: 'w-24 h-24',
    lg: 'w-48 h-48',
    xl: 'w-64 h-64'
  };

  const colors = persona === 'amo' 
    ? { primary: '#5A5A40', secondary: '#A0A080', accent: '#C5A358', glow: 'rgba(90, 90, 64, 0.2)' } // Warm Gold/Ochre
    : { primary: '#405A5A', secondary: '#80A0A0', accent: '#58C5A3', glow: 'rgba(64, 90, 90, 0.2)' }; // Soft Seafoam/Teal

  return (
    <div className={`relative flex items-center justify-center ${sizeClasses[size]}`}>
      {/* Organic Ripple for Listening/Speaking */}
      <AnimatePresence>
        {(isListening || isSpeaking) && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: `2px solid ${colors.primary}` }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ 
              scale: [1, 1.5], 
              opacity: [0.5, 0] 
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeOut"
            }}
          />
        )}
      </AnimatePresence>

      {/* Main Avatar Container */}
      <motion.div
        className="relative w-full h-full flex items-center justify-center"
        animate={{
          scale: isSpeaking ? [1, 1.03, 1] : 1,
        }}
        transition={{
          duration: 2,
          repeat: isSpeaking ? Infinity : 0,
          ease: "easeInOut"
        }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-xl">
          <defs>
            <linearGradient id={`grad-${persona}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.primary} />
              <stop offset="100%" stopColor={colors.secondary} />
            </linearGradient>
          </defs>

          {/* Koru Spiral Design - Organic Flow */}
          <motion.path
            d="M50 95 C 65 85, 75 70, 75 50 C 75 30, 60 15, 40 15 C 25 15, 15 25, 15 40 C 15 55, 25 65, 40 65 C 50 65, 58 58, 58 50 C 58 42, 52 35, 45 35 C 40 35, 35 38, 35 42 C 35 45, 38 48, 42 48 C 45 48, 48 45, 48 42"
            fill="none"
            stroke={`url(#grad-${persona})`}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ 
              pathLength: 1, 
              opacity: 1,
            }}
            transition={{
              pathLength: { duration: 2, ease: "easeInOut" },
              opacity: { duration: 1 }
            }}
          />

          {/* Flowing Energy Effect when speaking */}
          {isSpeaking && (
            <motion.path
              d="M50 95 C 65 85, 75 70, 75 50 C 75 30, 60 15, 40 15 C 25 15, 15 25, 15 40 C 15 55, 25 65, 40 65 C 50 65, 58 58, 58 50 C 58 42, 52 35, 45 35 C 40 35, 35 38, 35 42 C 35 45, 38 48, 42 48 C 45 48, 48 45, 48 42"
              fill="none"
              stroke={colors.accent}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="1, 20"
              animate={{
                strokeDashoffset: [0, -100]
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "linear"
              }}
              className="opacity-40"
            />
          )}

          {/* Gentle Pulse at the heart when listening */}
          {isListening && (
            <motion.circle
              cx="45"
              cy="42"
              r="6"
              fill={colors.accent}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.2, 0.6, 0.2]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
          )}
        </svg>
      </motion.div>
    </div>
  );
};

export default AmoAvatar;

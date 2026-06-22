import { motion } from 'framer-motion'
import { Mail } from 'lucide-react'

export default function ContactButton() {
  return (
    <motion.button
      type="button"
      className="flex items-center gap-2.5 rounded-full text-white font-semibold uppercase tracking-widest px-8 py-3 sm:px-10 sm:py-3.5 md:px-12 md:py-4 text-xs sm:text-sm md:text-base cursor-pointer"
      style={{
        background: 'linear-gradient(123deg, #18011F 7%, #B600A8 37%, #7621B0 72%, #BE4C00 100%)',
        outline: '2px solid rgba(255,255,255,0.9)',
        outlineOffset: '-3px',
      }}
      initial={{
        boxShadow: '0px 4px 12px rgba(181,1,167,0.3), inset 3px 3px 10px rgba(119,33,177,0.5)',
      }}
      whileHover={{
        scale: 1.05,
        boxShadow: '0px 8px 32px rgba(181,1,167,0.7), 0px 2px 8px rgba(181,1,167,0.45), inset 3px 3px 10px rgba(119,33,177,0.8)',
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <Mail size={14} className="shrink-0" />
      Get In Touch
    </motion.button>
  )
}

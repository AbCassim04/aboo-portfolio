import FadeIn from '../components/FadeIn'
import ContactButton from '../components/ContactButton'
import AnimatedText from '../components/AnimatedText'

const MOON = 'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/moon_icon.11395d36.png'
const P59 = 'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/p59_1.4659672e.png'
const LEGO = 'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/lego_icon-1.703bb594.png'
const GROUP = 'https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/Group_134-1.2e04f3ce.png'

const ABOUT_TEXT =
  "Third-year Computer Science and Mathematics student at Wits University. I build full-stack products, conduct AI safety research, and apply deep mathematical thinking to real engineering problems. Currently exploring machine learning and mechanistic interpretability. Let's build something that matters."

export default function AboutSection() {
  return (
    <section
      id="about"
      className="relative min-h-screen px-5 sm:px-8 md:px-10 py-20 flex flex-col items-center overflow-hidden"
      style={{ background: '#0C0C0C' }}
    >
      {/* Decorative 3D images */}
      <FadeIn delay={0.1} x={-80} className="absolute w-[120px] sm:w-[160px] md:w-[210px] top-[4%] left-[1%] sm:left-[2%] md:left-[4%] pointer-events-none">
        <img src={MOON} alt="" draggable={false} className="w-full" />
      </FadeIn>
      <FadeIn delay={0.25} x={-80} className="absolute w-[100px] sm:w-[140px] md:w-[180px] bottom-[8%] left-[3%] sm:left-[6%] md:left-[10%] pointer-events-none">
        <img src={P59} alt="" draggable={false} className="w-full" />
      </FadeIn>
      <FadeIn delay={0.15} x={80} className="absolute w-[120px] sm:w-[160px] md:w-[210px] top-[4%] right-[1%] sm:right-[2%] md:right-[4%] pointer-events-none">
        <img src={LEGO} alt="" draggable={false} className="w-full" />
      </FadeIn>
      <FadeIn delay={0.3} x={80} className="absolute w-[130px] sm:w-[170px] md:w-[220px] bottom-[8%] right-[3%] sm:right-[6%] md:right-[10%] pointer-events-none">
        <img src={GROUP} alt="" draggable={false} className="w-full" />
      </FadeIn>

      {/* Content */}
      <div className="flex flex-col items-center gap-10 sm:gap-14 md:gap-16 relative z-10">
        <FadeIn delay={0} y={40}>
          <h2
            className="hero-heading font-black uppercase text-center"
            style={{ fontSize: 'clamp(3rem, 12vw, 160px)' }}
          >
            About me
          </h2>
        </FadeIn>

        <AnimatedText
          text={ABOUT_TEXT}
          className="text-[#D7E2EA] font-medium text-center leading-relaxed max-w-[560px]"
          style={{ fontSize: 'clamp(1rem, 2vw, 1.35rem)' }}
        />
      </div>

      <div className="mt-16 sm:mt-20 md:mt-24 relative z-10">
        <ContactButton />
      </div>
    </section>
  )
}

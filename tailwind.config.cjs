module.exports = {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './{components,hooks,services,utils}/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#09090B', card: '#131316', hover: '#1A1A1E' },
        border: { DEFAULT: '#232329', light: '#2E2E36' },
        accent: { DEFAULT: '#8B5CF6', hover: '#7C3AED' },
        text: { DEFAULT: '#ECECF1', muted: '#71717A', dim: '#52525B' },
        sev1: '#EF4444', sev2: '#F97316', sev3: '#EAB308',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      fontSize: { '2xs': '11px' },
    },
  },
};

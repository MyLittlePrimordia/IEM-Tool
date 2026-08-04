/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["../Index.html"],
  // Default Tailwind theme — matches what the browser Play CDN build (js/tailwindcss.js)
  // was using, since no inline tailwind.config override was present in the app.
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: true,
  },
};

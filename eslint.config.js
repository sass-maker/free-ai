import config from "@saas-maker/eslint-config/vite-legacy";

export default [
  {
    ignores: ["site/.astro/**", "site/dist/**"],
  },
  ...config,
];

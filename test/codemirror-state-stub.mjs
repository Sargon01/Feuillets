export const StateEffect = {
  define: () => ({ of: (value) => ({ value }) }),
};

export const StateField = {
  define: (config) => config,
};

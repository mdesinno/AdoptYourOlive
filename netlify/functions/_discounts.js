// netlify/functions/_discounts.js
module.exports = {
  // ESEMPI — metti qui i tuoi (gli stessi che avevi in validate-code)
  'BENVENUTO10': { type: 'percentage', value: 10 },
  'SPECIALE15':  { type: 'fixed', value: 1500 }, // 15,00€

  // I TUOI CODICI
  'FOODANATOMIST': { type: 'percentage', value: 10 },
    'BLONDEELIVING': { type: 'percentage', value: 10 },
    'DENISEKORTLEVER': { type: 'percentage', value: 10 },
    'TRAVELTOGETHER': { type: 'percentage', value: 10 },
    'INGEPUTKER': { type: 'percentage', value: 10 },
    'STUKORECEPTJES': { type: 'percentage', value: 10 },
    'MYFOODBLOG': { type: 'percentage', value: 10 },
    'KEUKENMEID': { type: 'percentage', value: 10 },
    'RETHINK10': { type: 'percentage', value: 10 },
    'SCONTOPROVA2': { type: 'fixed', value: 4700 }

  // ...aggiungi gli altri come già facevi
};

// Registrazione del Service Worker per la PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('AYO Service Worker registrato con successo.');
      })
      .catch(error => {
        console.log('Registrazione Service Worker fallita:', error);
      });
  });
}

// Funzione per caricare la chiave e lo script di Google Maps in modo sicuro
async function loadGoogleMapsScript() {
    try {
        const response = await fetch('/.netlify/functions/get-maps-key');
        if (!response.ok) throw new Error("Errore nel fetch della chiave API");
        const data = await response.json();
        const apiKey = data.apiKey;
        if (!apiKey) throw new Error("Chiave API di Google Maps non trovata.");
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initAutocomplete`;
        script.async = true;
        document.head.appendChild(script);
    } catch (error) {
        console.error("Impossibile caricare lo script di Google Maps:", error);
    }
}

// --- Caricamento on-demand di Google Analytics (dopo consenso) ---
window.loadGA = function () {
  if (window.gaLoaded) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-FE1BSWKNP8';
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', 'G-FE1BSWKNP8', { anonymize_ip: true });
  window.gaLoaded = true;
};


// --- GESTIONE TOKEN CLUB con scadenza "gentile" ---
// (Se il token NON ha scadenza perché salvato in passato, lo accettiamo lo stesso.)

// (In futuro, quando salverai il token dopo il login, usa questa helper:)
function saveClubTokenWithExpiry(token, days = 30) {
  const exp = Date.now() + days * 24 * 60 * 60 * 1000; // 30 giorni
  localStorage.setItem('ayoClubToken', token);
  localStorage.setItem('ayoClubTokenExp', String(exp));
}

// Legge il token e controlla la scadenza (se c'è). 
// Se non c'è scadenza (vecchio salvataggio), lo considera valido per compatibilità.
function getValidClubToken() {
  const t = localStorage.getItem('ayoClubToken');
  if (!t) return null;
  const expStr = localStorage.getItem('ayoClubTokenExp');
  if (!expStr) return t; // compatibilità: token salvati prima della scadenza
  const exp = parseInt(expStr, 10) || 0;
  if (Date.now() < exp) return t;
  // scaduto: pulisco e invalido
  localStorage.removeItem('ayoClubToken');
  localStorage.removeItem('ayoClubTokenExp');
  return null;
}

// SOSTITUISCI la tua funzione con questa:
function handleClubLinkClick(event) {
  event.preventDefault();
  const token = getValidClubToken();
  if (token) {
    window.location.href = `club.html?token=${token}`;
  } else {
    window.location.href = 'club-login.html';
  }
}


function initAutocomplete() {
    const addressInput = document.getElementById('address');
    if (!addressInput) return;
    const options = { types: ['address'], fields: ['address_components', 'name'] };
    try {
        const autocomplete = new google.maps.places.Autocomplete(addressInput, options);
        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.address_components) return;
            // Pulisci i campi prima di popolarli
            document.getElementById('city').value = '';
            document.getElementById('postal-code').value = '';
            document.getElementById('country').value = '';
            addressInput.value = '';
            
            let streetNumber = '', route = '';
            for (const component of place.address_components) {
                const componentType = component.types[0];
                switch (componentType) {
                    case "street_number": streetNumber = component.long_name; break;
                    case "route": route = component.long_name; break;
                    case "locality": document.getElementById('city').value = component.long_name; break;
                    case "postal_code": document.getElementById('postal-code').value = component.long_name; break;
                    case "country": document.getElementById('country').value = component.short_name; break;
                }
            }
            addressInput.value = `${route} ${streetNumber}`.trim();
            document.getElementById('address-2').focus();
        });
    } catch (e) {
        console.warn("Google Maps Autocomplete non ha potuto inizializzarsi.", e);
    }
}
window.initAutocomplete = initAutocomplete;

// --- FUNZIONI DI INTERNAZIONALIZZAZIONE (i18n) ---
let i18nData = { en: {}, current: {} };
let currentLang = localStorage.getItem('language') || 'it';

async function fetchTranslations(lang) {
    try {
        const response = await fetch(`/traduzioni/${lang}.json`);
        if (!response.ok) throw new Error(`Non ho potuto caricare ${lang}.json`);
        return await response.json();
    } catch (error) {
        console.error(error);
        return i18nData.en; // Fallback all'inglese
    }
}

function getTranslation(key, replacements = {}) {
    const fallbackLang = i18nData.en || {};
    const currentLangData = i18nData.current || fallbackLang;
    let text = currentLangData[key] || fallbackLang[key] || '';
    for (const placeholder in replacements) {
        text = text.replace(`{${placeholder}}`, replacements[placeholder]);
    }
    return text;
}

async function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('language', lang);
    document.documentElement.lang = lang;

   /* // ==> INIZIO BLOCCO HREFLANG <==
    // Rimuovi i vecchi tag hreflang per evitare duplicati
    document.querySelectorAll('link[rel="alternate"]').forEach(el => el.remove());

    const languages = ['it', 'en', 'de', 'nl', 'no', 'fr'];
    const baseUrl = 'https://www.adoptyourolive.com/'; // Assicurati che l'URL sia corretto

    languages.forEach(langCode => {
        const link = document.createElement('link');
        link.rel = 'alternate';
        link.hreflang = langCode;
        link.href = baseUrl;
        document.head.appendChild(link);
    });
    // ==> FINE BLOCCO HREFLANG <== */

    if (Object.keys(i18nData.en).length === 0) {
        i18nData.en = await fetchTranslations('en');
    }
    i18nData.current = (lang === 'en') ? i18nData.en : (await fetchTranslations(lang));

    // Questo è il blocco CORRETTO
    document.querySelectorAll('[data-i18n-key]').forEach(element => {
        const key = element.getAttribute('data-i18n-key');
        const translation = getTranslation(key); // Prendi la traduzione PRIMA

        // Controlla se la TRADUZIONE stessa contiene HTML
        if (translation.includes('<')) { 
            element.innerHTML = translation;
        } else {
            element.textContent = translation;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder-key]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder-key');
        element.placeholder = getTranslation(key);
    });
}


// --- FUNZIONI SPECIFICHE PER LA PAGINA PRINCIPALE ---
let selectedTreeType = '';
let selectedPrice = 0.0;
const clickTracker = {
    young: parseInt(localStorage.getItem('clicks_young') || '0'),
    mature: parseInt(localStorage.getItem('clicks_mature') || '0'),
    ancient: parseInt(localStorage.getItem('clicks_ancient') || '0'),
    historic: parseInt(localStorage.getItem('clicks_historic') || '0')
};

function updateMostPopular() {
    document.querySelectorAll('.popular-badge').forEach(badge => badge.style.display = 'none');
    document.querySelectorAll('.product-card.popular').forEach(card => card.classList.remove('popular'));
    const mostPopularType = Object.keys(clickTracker).reduce((a, b) => clickTracker[a] > clickTracker[b] ? a : b);
    const mostPopularCard = document.querySelector(`.product-card[data-tree-type="${mostPopularType}"] .popular-badge`);
    if (mostPopularCard) {
        mostPopularCard.style.display = 'block';
        mostPopularCard.parentElement.classList.add('popular');
    }
}

function updatePriceUI(price) {
    const priceString = `€${price.toFixed(2).replace('.', ',')}`;
    document.getElementById('selected-tree-price').textContent = priceString;
    document.getElementById('summary-price').textContent = priceString;
    document.getElementById('total-price').textContent = priceString;
}

// Assicurati che la tua funzione selectTree sia questa
function selectTree(treeType) {
    if(clickTracker.hasOwnProperty(treeType)) {
        clickTracker[treeType]++;
        localStorage.setItem(`clicks_${treeType}`, clickTracker[treeType].toString());
    }
    updateMostPopular();
    document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
    const selectedCardElement = document.querySelector(`.product-card[data-tree-type="${treeType}"]`);
    if (selectedCardElement) {
        selectedCardElement.classList.add('selected');
        selectedPrice = parseFloat(selectedCardElement.dataset.price);
        selectedTreeType = treeType;
        sessionStorage.setItem('selectedTree', treeType);
    }
    document.getElementById('tree-type').value = treeType;
    updatePriceUI(selectedPrice);
    updateTreeSelectionDisplay();

    // ==> BLOCCO AGGIUNTO CHE RISOLVE IL PROBLEMA <==
    // Dopo aver selezionato un prodotto, controlla se c'è un codice in attesa (dall'URL)
    // e se il pulsante "Applica" è ancora attivo. Se sì, lo clicca per l'utente.
    const discountCodeInput = document.getElementById('discount-code');
    const applyDiscountBtn = document.getElementById('apply-discount-btn');
    if (discountCodeInput.value && !discountCodeInput.disabled) {
        applyDiscountBtn.click();
    }
    // ==> FINE BLOCCO AGGIUNTO <==

    const formSection = document.getElementById('personalization');
    if (formSection) {
        const navHeight = document.querySelector('.main-nav')?.offsetHeight || 0;
        const elementPosition = formSection.getBoundingClientRect().top + window.pageYOffset - navHeight - 20;
        window.scrollTo({ top: elementPosition, behavior: 'smooth' });
    }
}

function updateTreeSelectionFromForm() {
    const treeSelect = document.getElementById('tree-type');
    const selectedOption = treeSelect.options[treeSelect.selectedIndex];
    if (selectedOption && selectedOption.value) {
        selectTree(selectedOption.value);
    } else {
        selectedTreeType = '';
        selectedPrice = 0;
        sessionStorage.removeItem('selectedTree');
        document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
        updatePriceUI(0);
        updateTreeSelectionDisplay();
    }
}

function updateTreeSelectionDisplay() {
    if (!document.getElementById('selected-tree-title')) return; // Esce se non è nella pagina principale
    
const treeNames = {
    'young': getTranslation('formTreeYoung').split(' - ')[0],
    'mature': getTranslation('formTreeMature').split(' - ')[0],
    'ancient': getTranslation('formTreeAncient').split(' - ')[0],
    'historic': getTranslation('formTreeHistoric').split(' - ')[0]
};
    const defaultText = getTranslation('formSelectedTreeDefault');
    const treeName = selectedTreeType ? treeNames[selectedTreeType] : defaultText;
    document.getElementById('selected-tree-title').textContent = treeName;
    document.getElementById('summary-tree').textContent = treeName;
    document.getElementById('preview-tree').textContent = selectedTreeType ? treeNames[selectedTreeType] : getTranslation('certTreeTypePlaceholder');
    updateCertificatePreview();
    checkFormValidity();
}

function updateCertificatePreview() {
    if (!document.getElementById('preview-name')) return; // Esce se non è nella pagina principale
    const certName = document.getElementById('certificate-name').value.trim() || `${document.getElementById('full-name').value.trim()}`.trim() || getTranslation('certYourNamePlaceholder');
    document.getElementById('preview-name').textContent = certName;
    document.getElementById('preview-message').textContent = document.getElementById('certificate-message').value.trim() || getTranslation('certMessagePlaceholder');
}

function updateCharCount() {
    const textarea = document.getElementById('certificate-message');
    if (!textarea) return; // Esce se non è nella pagina principale
    const counter = textarea.parentElement.querySelector('.char-count');
    if(counter) {
        counter.textContent = getTranslation('formCharCount', { length: textarea.value.length });
    }
}

function checkFormValidity() {
    const completeBtn = document.getElementById('complete-adoption-btn');
    if (!completeBtn) return; // Esce se non è nella pagina principale

    const requiredFields = document.querySelectorAll('#adoption-form [required]');
    let allValid = selectedTreeType !== '';
    requiredFields.forEach(field => {
        if (!field.value.trim()) allValid = false;
    });
    completeBtn.disabled = !allValid;
    let buttonTextKey = 'formButtonCompleteFields';
    if(allValid) {
        buttonTextKey = selectedPrice > 0 ? 'formButtonCompletePay' : 'formButtonCompleteDefault';
    }
    completeBtn.textContent = getTranslation(buttonTextKey, { price: selectedPrice.toFixed(2).replace('.', ',') });
}


// --- PUNTO DI INGRESSO PRINCIPALE ---
document.addEventListener('DOMContentLoaded', async () => {

    // --- LOGICA GLOBALE (per tutte le pagine) ---
    await setLanguage(currentLang);

    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
        languageSelector.value = currentLang;
        languageSelector.addEventListener('change', (event) => setLanguage(event.target.value).then(() => {
             // Aggiorna la UI della pagina principale se ci troviamo lì
            if (document.getElementById('adoption-form')) {
                updateTreeSelectionDisplay();
                updateMostPopular();
                updateCharCount();
                checkFormValidity();
            }
        }));
    }
    
   const handleNetlifyFormSubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const modal = document.getElementById('success-modal');

    // 1. Crea l'oggetto FormData dal form, che conterrà tutti i campi tranne la lingua.
    const formData = new FormData(form);
    
    // 2. AZIONE CHIAVE: Aggiungi la lingua al pacchetto di dati, leggendola
    //    direttamente dall'attributo <html>, esattamente come fa il form di adozione.
    formData.set('language', document.documentElement.lang || 'it');
    
    if (submitButton) submitButton.disabled = true;
    try {
        await fetch('/', {
            method: 'POST',
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(formData).toString()
        });
        if (modal) modal.classList.add('visible');
        form.reset();
    } catch (error) {
        alert('Si è verificato un errore, riprova.');
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
};
    // --- Newsletter: invia alla Function newsletter-intake ---
async function handleNewsletterSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const modal = document.getElementById('success-modal');

  const email = document.getElementById('newsletter-email')?.value.trim();
  const language = document.documentElement.lang || 'it';
  const name = ''; // se vuoi chiedere il nome, cambiamo qui

  if (!email) { alert('Inserisci la tua email'); return; }

  btn && (btn.disabled = true);
  try {
    const res = await fetch('/.netlify/functions/newsletter-intake', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ email, language, name })
    });
    if (!res.ok) throw new Error('Errore server');
    modal?.classList.add('visible');
    form.reset();
  } catch (err) {
    alert('Si è verificato un errore, riprova.');
  } finally {
    btn && (btn.disabled = false);
  }
}

// --- Contatti: invia alla Function contact-intake ---
async function handleContactSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const modal = document.getElementById('success-modal');

  const name = document.getElementById('contact-name')?.value.trim() || '';
  const email = document.getElementById('contact-email')?.value.trim() || '';
  const message = document.getElementById('contact-message')?.value.trim() || '';
  const language = document.documentElement.lang || 'it';

  if (!email || !message) { alert('Email e messaggio sono obbligatori'); return; }

  btn && (btn.disabled = true);
  try {
    const res = await fetch('/.netlify/functions/contact-intake', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ name, email, message, language })
    });
    if (!res.ok) throw new Error('Errore server');
    modal?.classList.add('visible');
    form.reset();
  } catch (err) {
    alert('Si è verificato un errore, riprova.');
  } finally {
    btn && (btn.disabled = false);
  }
}

// Collega gli handler giusti ai due form
document.getElementById('newsletter-form')?.addEventListener('submit', handleNewsletterSubmit);
document.getElementById('contact-form')?.addEventListener('submit', handleContactSubmit);


    document.getElementById('close-modal-btn')?.addEventListener('click', () => document.getElementById('success-modal').classList.remove('visible'));
    document.getElementById('success-modal')?.addEventListener('click', (e) => { if (e.target.id === 'success-modal') e.target.classList.remove('visible'); });
    
    // Gestione chiusura Info Modal
    document.getElementById('close-info-modal-btn')?.addEventListener('click', () => {
        document.getElementById('info-modal').classList.remove('visible');
    });

    document.getElementById('info-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'info-modal') {
            e.target.classList.remove('visible');
        }
    });

    const nav = document.querySelector('.main-nav');
    window.addEventListener('scroll', () => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
        let currentSectionId = document.body.id === 'index-body' ? 'hero' : ''; // Default section
        document.querySelectorAll('section[id]').forEach(section => {
            if (window.pageYOffset >= section.offsetTop - nav.offsetHeight) currentSectionId = section.id;
        });
        document.querySelectorAll('.nav-links a').forEach(link => {
            link.classList.toggle('active-link', link.getAttribute('href') === `#${currentSectionId}`);
        });
    });
    
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetElement = document.querySelector(this.getAttribute('href'));
            if (targetElement) {
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - nav.offsetHeight;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
                if (navLinks.classList.contains('open')) navLinks.classList.remove('open');
            }
        });
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animated');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));

    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', () => {
            const wasActive = q.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(item => {
                item.querySelector('.faq-question').classList.remove('active');
                item.querySelector('.faq-answer').classList.remove('open');
            });
            if (!wasActive) {
                q.classList.add('active');
                q.nextElementSibling.classList.add('open');
            }
        });
    });

    const consentManager = {
        banner: document.getElementById('cookie-banner'),
        preferencesModal: document.getElementById('cookie-preferences-modal'),
        init() {
            if (!this.banner || !this.preferencesModal) return;
            const consent = this.getConsent();
            if (consent) {
                this.executeConsentedScripts(consent);
            } else {
                this.showBanner();
            }
            this.addEventListeners();
        },
        getConsent: () => JSON.parse(localStorage.getItem('cookieConsentAyo')),
        saveConsent(consent) {
            localStorage.setItem('cookieConsentAyo', JSON.stringify(consent));
            this.hideAll();
            this.executeConsentedScripts(consent);
        },
executeConsentedScripts(consent) {
    // Funzionali: Google Maps (solo se c'è il form adozione)
    if (consent.functional && typeof window.loadGoogleMapsScript === 'function') {
        if (document.getElementById('adoption-form')) window.loadGoogleMapsScript();
    }
    // Analitici: Google Analytics
    if (consent.analytics && typeof window.loadGA === 'function') {
        window.loadGA();
    }
},

        showBanner() { this.banner.classList.add('visible'); },
        showPreferences() {
            this.hideAll();
            const currentConsent = this.getConsent() || { analytics: false, functional: false };
            document.getElementById('consent-analytics').checked = currentConsent.analytics;
            document.getElementById('consent-functional').checked = currentConsent.functional;
            this.preferencesModal.classList.add('visible');
        },
        hideAll() {
            this.banner.classList.remove('visible');
            this.preferencesModal.classList.remove('visible');
        },
        addEventListeners() {
            document.getElementById('accept-cookies-all-btn')?.addEventListener('click', () => this.saveConsent({ necessary: true, analytics: true, functional: true }));
            document.getElementById('decline-cookies-all-btn')?.addEventListener('click', () => this.saveConsent({ necessary: true, analytics: false, functional: false }));
            document.getElementById('close-cookie-banner-btn')?.addEventListener('click', () => this.saveConsent({ necessary: true, analytics: false, functional: false }));
            document.getElementById('customize-cookies-btn')?.addEventListener('click', () => this.showPreferences());
            document.getElementById('save-preferences-btn')?.addEventListener('click', () => {
                this.saveConsent({
                    necessary: true,
                    analytics: document.getElementById('consent-analytics').checked,
                    functional: document.getElementById('consent-functional').checked
                });
            });
            document.getElementById('modify-cookie-preferences-link')?.addEventListener('click', (e) => { e.preventDefault(); this.showPreferences(); });
        }
    };
    consentManager.init();


    // --- LOGICA SOLO PER LA PAGINA PRINCIPALE ---
    // Controlliamo se esiste un elemento chiave della pagina principale.
    if (document.getElementById('adoption-form')) {
        let appliedDiscountRate = 0;
        const discountCodeInput = document.getElementById('discount-code');
        const applyDiscountBtn = document.getElementById('apply-discount-btn');
        const discountFeedbackEl = document.getElementById('discount-feedback');
        const hiddenRefInput = document.getElementById('referral-code-input');
        const refreshDiscountBtn = document.getElementById('refresh-discount-btn');
const discountWarning = document.getElementById('discount-warning');
// Gestione visibilità campi regalo
const isGiftCheckbox = document.getElementById('is-gift');
const giftFieldsContainer = document.getElementById('gift-fields-container');
const recipientEmailInput = document.getElementById('recipient-email');

if (isGiftCheckbox && giftFieldsContainer && recipientEmailInput) {
    isGiftCheckbox.addEventListener('change', () => {
        giftFieldsContainer.classList.toggle('visible');
        // Rende il campo email del ricevente obbligatorio solo se la sezione è visibile
        recipientEmailInput.required = false;
        checkFormValidity(); // Ricalcola la validità del form
    });
}
        
applyDiscountBtn.addEventListener('click', async () => {
    const code = discountCodeInput.value.trim().toUpperCase();
    if (!code || selectedPrice === 0) {
        discountFeedbackEl.textContent = getTranslation('feedbackErrorNoCodeOrProduct');
        discountFeedbackEl.className = 'discount-feedback error';
        return;
    }
    try {
        const response = await fetch('/.netlify/functions/validate-code', {
            method: 'POST', body: JSON.stringify({ code })
        });
        const data = await response.json();

        if (data.valid) {
            let discountedPrice = 0;
            let feedbackText = '';

            // NUOVA LOGICA PER GESTIRE I DUE TIPI DI SCONTO
            if (data.discount.type === 'percentage') {
                const rate = data.discount.value / 100;
                discountedPrice = selectedPrice * (1 - rate);
                feedbackText = getTranslation('feedbackSuccess', { rate: data.discount.value });
            } else if (data.discount.type === 'fixed') {
                const amount = data.discount.value / 100; // Converte i centesimi in euro
                discountedPrice = selectedPrice - amount;
                // Assicurati che il prezzo non vada sotto zero
                if (discountedPrice < 0) discountedPrice = 0;
                feedbackText = getTranslation('feedbackSuccessFixed', { amount: amount.toFixed(2).replace('.', ',') });
            }

            updatePriceUI(discountedPrice);
            discountFeedbackEl.textContent = feedbackText;
            discountFeedbackEl.className = 'discount-feedback success';
            
            discountCodeInput.disabled = true;
            applyDiscountBtn.style.display = 'none';
            refreshDiscountBtn.style.display = 'inline-block';
            discountWarning.style.display = 'block';

            if(hiddenRefInput) hiddenRefInput.value = code;
        } else {
            discountFeedbackEl.textContent = getTranslation('feedbackErrorInvalidCode');
            discountFeedbackEl.className = 'discount-feedback error';
        }
    } catch (error) {
        discountFeedbackEl.textContent = getTranslation('feedbackErrorServer');
        discountFeedbackEl.className = 'discount-feedback error';
    }
});

refreshDiscountBtn.addEventListener('click', async () => {
    // Il pulsante Ricalcola funziona come Applica, ma con il campo già bloccato.
    // Usiamo direttamente il gestore di applyDiscountBtn per non duplicare il codice.
    await applyDiscountBtn.click();
});

// Questo nuovo blocco gestisce tutto: prodotto e referral da URL, e selezione da sessione
const urlParams = new URLSearchParams(window.location.search);
const productFromUrl = urlParams.get('product');
const refCodeFromUrl = urlParams.get('ref');
const storedTreeType = sessionStorage.getItem('selectedTree');

if (refCodeFromUrl) {
    // Se c'è un codice nell'URL, lo validiamo subito in background
    (async () => {
        try {
            const response = await fetch('/.netlify/functions/validate-code', {
                method: 'POST', body: JSON.stringify({ code: refCodeFromUrl })
            });
            const data = await response.json();
            if (data.valid) {
                // SOLO SE è valido, lo scriviamo nel campo e lo applichiamo
                document.getElementById('discount-code').value = refCodeFromUrl;
                document.getElementById('apply-discount-btn').click();
            }
        } catch (error) {
            console.error("Errore validazione codice da URL:", error);
        }
    })();
}

if (productFromUrl) {
    selectTree(productFromUrl);
} else if (storedTreeType) {
    selectTree(storedTreeType);
} else {
    updateTreeSelectionDisplay();
}
        
const adoptionForm = document.getElementById('adoption-form');
if (adoptionForm) {
    adoptionForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // Impedisce al form di ricaricare la pagina

        const submitButton = adoptionForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = 'Creazione pagamento...';

        const formData = new FormData(adoptionForm);
        const treeType = formData.get('tree-type');
        const customerEmail = formData.get('email');
        const discountCode = document.getElementById('discount-code').value.trim();

        const selectedOption = document.querySelector(`#tree-type option[value="${treeType}"]`);
        const price = selectedOption ? selectedOption.dataset.price : '0';

        // QUESTO BLOCCO È FONDAMENTALE: crea l'oggetto 'shippingDetails'
        const data = {
            treeType: treeType,
            price: parseFloat(price),
            customerEmail: customerEmail,
            discountCode: discountCode,
            shippingDetails: {
                name: `${formData.get('full-name')}`,
                address: {
                    line1: formData.get('address'),
                    line2: formData.get('address-2'),
                    city: formData.get('city'),
                    postal_code: formData.get('postal-code'),
                    country: formData.get('country'),
                }
            },
            certificateName: formData.get('certificate-name'),
    certificateMessage: formData.get('certificate-message'),
    language: document.documentElement.lang || 'it',
    
    // ===== RIGHE DA AGGIUNGERE =====
    isGift: document.getElementById('is-gift').checked,
    recipientEmail: formData.get('recipient-email'),
    orderNote: formData.get('order-note')
    // =============================
        };

        try {
            // Chiama la funzione Netlify per creare una sessione Stripe
            const response = await fetch('/.netlify/functions/create-stripe-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                // Se la funzione serverless stessa restituisce un errore, lo gestiamo qui
                const errorBody = await response.json();
                throw new Error(errorBody.error || 'Errore dal server durante la creazione del pagamento.');
            }

            const responseData = await response.json();

            // Reindirizza l'utente alla pagina di pagamento sicura di Stripe
            if (responseData.checkoutUrl) {
                window.location.href = responseData.checkoutUrl;
            } else {
                throw new Error('URL di pagamento non ricevuto.');
            }

        } catch (error) {
            console.error(error);
            alert('Si è verificato un errore imprevisto. Riprova più tardi.');
            submitButton.disabled = false;
            checkFormValidity(); // Riattiva il pulsante
        }
    });
}

        document.querySelectorAll('#adoption-form input, #adoption-form select, #adoption-form textarea').forEach(input => {
            if(input.id !== 'discount-code'){
                input.addEventListener((input.tagName === 'SELECT' ? 'change' : 'input'), checkFormValidity);
            }
            if (['certificate-name', 'certificate-message', 'full-name'].includes(input.id)) {
                input.addEventListener('input', updateCertificatePreview);
            }
            if (input.id === 'certificate-message') input.addEventListener('input', updateCharCount);
        });

         const countrySelect = document.getElementById('country');
        const customsWarning = document.getElementById('customs-warning');

        if (countrySelect && customsWarning) {
            countrySelect.addEventListener('change', () => {
                const selectedCountry = countrySelect.value;
                // Mostra l'avviso solo per Regno Unito (GB) e Svizzera (CH)
                if (selectedCountry === 'GB' || selectedCountry === 'CH') {
                    customsWarning.style.display = 'block';
                } else {
                    customsWarning.style.display = 'none';
                }
            });
        }

        let slideIndex = 0;
        const slides = document.querySelectorAll("#gallery .slide");
        const dots = document.querySelectorAll("#gallery .dot");
        function showSlides(n) {
            if (slides.length === 0) return;
            slideIndex = (n + slides.length) % slides.length;
            slides.forEach(slide => slide.classList.remove("active"));
            dots.forEach(dot => dot.classList.remove("active"));
            slides[slideIndex].classList.add("active");
            dots[slideIndex].classList.add("active");
        }
        window.plusSlides = (n) => showSlides(slideIndex + n);
        window.currentSlide = (n) => showSlides(n - 1);
        showSlides(slideIndex);

                // --- Rendi NON obbligatori i campi indirizzo (Stripe li chiede in checkout) ---
        (function makeAddressFieldsOptional(){
          ['address','address-2','city','postal-code','country'].forEach(id=>{
            const el = document.getElementById(id);
            if (el) el.removeAttribute('required');
          });
        })();

        // --- Autofill: se "Nome per il Certificato" è vuoto, metti il Nome Completo
(function autoFillCertificateName(){
  const full = document.getElementById('full-name');
  const cert = document.getElementById('certificate-name');
  if (!full || !cert) return;
  full.addEventListener('blur', () => {
    if (!cert.value.trim()) cert.value = full.value.trim();
  });
})();

        
        // === EXIT-INTENT POPUP (versione più educata) ===
        const exitIntentPopup = document.getElementById('exit-intent-popup');
        if (exitIntentPopup) {
            const SESSION_KEY = 'exitIntentShownAyo';
            let exitDelayOk = false;
            let scrolledOk = false;

            const showExitPopup = () => {
                if (!sessionStorage.getItem(SESSION_KEY)) {
                    exitIntentPopup.style.display = 'flex';
                    sessionStorage.setItem(SESSION_KEY, 'true');
                }
            };

            // Attendi almeno 45s prima di poter mostrare il popup
            setTimeout(() => { exitDelayOk = true; }, 45000);

            // Mostra solo se l'utente ha scrollato almeno 400px
            window.addEventListener('scroll', () => {
                if (!scrolledOk && window.scrollY > 400) scrolledOk = true;
            }, { passive: true });

            // Trigger di uscita SOLO su desktop e solo se ha “ingaggiato”
            document.addEventListener('mouseout', (e) => {
                const isDesktop = window.innerWidth > 992;
                const leavingTop = e.clientY < 0 && !e.relatedTarget && !e.toElement;
                if (isDesktop && leavingTop && exitDelayOk && scrolledOk) {
                    showExitPopup();
                }
            });

            document.getElementById('close-exit-popup')?.addEventListener('click', () => {
                exitIntentPopup.style.display = 'none';
            });
        }
    } // --- FINE BLOCCO IF per la pagina principale

     const track = document.querySelector('.recipe-slider-track');
    const prevBtn = document.getElementById('recipe-prev-btn');
    const nextBtn = document.getElementById('recipe-next-btn');

    if (track && prevBtn && nextBtn) {
        nextBtn.addEventListener('click', () => {
            const card = track.querySelector('.club-card');
            if (card) {
                // Calcola quanto scorrere: larghezza della card + margine
                const scrollAmount = card.offsetWidth + 30; // 30px è il margine (15px a dx + 15px a sx)
                track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
            }
        });

        prevBtn.addEventListener('click', () => {
            const card = track.querySelector('.club-card');
            if (card) {
                const scrollAmount = card.offsetWidth + 30;
                track.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
            }
        });
    }
});
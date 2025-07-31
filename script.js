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

    // ==> INIZIO BLOCCO HREFLANG <==
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
    // ==> FINE BLOCCO HREFLANG <==

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
    digital: parseInt(localStorage.getItem('clicks_digital') || '0'),
    young: parseInt(localStorage.getItem('clicks_young') || '0'),
    mature: parseInt(localStorage.getItem('clicks_mature') || '0'),
    centenary: parseInt(localStorage.getItem('clicks_centenary') || '0')
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
        'digital': getTranslation('formTreeDigital').split(' - ')[0],
        'young': getTranslation('formTreeYoung').split(' - ')[0],
        'mature': getTranslation('formTreeMature').split(' - ')[0],
        'centenary': getTranslation('formTreeCentenary').split(' - ')[0]
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
    const certName = document.getElementById('certificate-name').value.trim() || `${document.getElementById('first-name').value.trim()} ${document.getElementById('last-name').value.trim()}`.trim() || getTranslation('certYourNamePlaceholder');
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
        const formData = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        const modal = document.getElementById('success-modal');
        form.querySelector('input[name="language"]').value = currentLang;
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
    document.getElementById('contact-form')?.addEventListener('submit', handleNetlifyFormSubmit);
    document.getElementById('newsletter-form')?.addEventListener('submit', handleNetlifyFormSubmit);

    document.getElementById('close-modal-btn')?.addEventListener('click', () => document.getElementById('success-modal').classList.remove('visible'));
    document.getElementById('success-modal')?.addEventListener('click', (e) => { if (e.target.id === 'success-modal') e.target.classList.remove('visible'); });
    
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
            if (consent.functional && typeof window.loadGoogleMapsScript === 'function') {
                if (document.getElementById('adoption-form')) window.loadGoogleMapsScript();
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
            const discountedPrice = selectedPrice * (1 - data.rate);
            updatePriceUI(discountedPrice);
            checkFormValidity();
            discountFeedbackEl.textContent = getTranslation('feedbackSuccess', { rate: data.rate * 100 });
            discountFeedbackEl.className = 'discount-feedback success';
            
            // Logica per mostrare/nascondere i pulsanti
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
adoptionForm.addEventListener('submit', (event) => {
    event.preventDefault(); // Impedisce l'invio immediato del form

    const submitButton = adoptionForm.querySelector('button[type="submit"]');
    
    // Funzione che gestisce l'invio dei dati DOPO che reCAPTCHA ha dato l'ok
    const handleFormSubmit = async () => {
        submitButton.disabled = true;
        submitButton.textContent = 'Creazione pagamento...';
        
        const formData = new FormData(adoptionForm);
        const data = Object.fromEntries(formData.entries());
        data.price = selectedPrice; // Invia sempre il prezzo base
        if(hiddenRefInput) data['referral-code'] = hiddenRefInput.value;
        
        try {
            const response = await fetch('/.netlify/functions/create-payment-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Errore di rete durante la creazione del pagamento.');
            
            const responseData = await response.json();
            if (responseData.paymentUrl) {
                window.location.href = responseData.paymentUrl;
            } else {
                throw new Error('URL di pagamento non ricevuto dal server.');
            }
        } catch (error) {
            console.error(error);
            alert('Si è verificato un errore durante la creazione del pagamento. Riprova più tardi.');
            submitButton.disabled = false;
            checkFormValidity();
        }
    };

    // Netlify gestisce il reCAPTCHA invisibile in background.
    // Quando il form viene inviato, Netlify aggiunge un campo nascosto 'g-recaptcha-response'.
    // Noi dobbiamo solo inviare il form. Se il campo non è valido, l'invio del form a Netlify fallirà.
    // Per questo, invece di complicare con callback, possiamo semplicemente inviare il form a Netlify.
    
    // A differenza di prima, non chiamiamo handleFormSubmit direttamente,
    // ma lasciamo che Netlify processi il submit dopo il nostro preventDefault().
    // La nostra funzione di backend Netlify NON verrà chiamata se il reCAPTCHA fallisce.
    
    // Per inviare il form programmaticamente in modo che Netlify lo processi:
handleFormSubmit();
});

        document.querySelectorAll('#adoption-form input, #adoption-form select, #adoption-form textarea').forEach(input => {
            if(input.id !== 'discount-code'){
                input.addEventListener((input.tagName === 'SELECT' ? 'change' : 'input'), checkFormValidity);
            }
            if (['certificate-name', 'certificate-message', 'first-name', 'last-name'].includes(input.id)) {
                input.addEventListener('input', updateCertificatePreview);
            }
            if (input.id === 'certificate-message') input.addEventListener('input', updateCharCount);
        });

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
        
        const exitIntentPopup = document.getElementById('exit-intent-popup');
        if (exitIntentPopup) {
            const showExitPopup = () => {
                if (!sessionStorage.getItem('exitIntentShownAyo')) {
                    exitIntentPopup.style.display = 'flex';
                    sessionStorage.setItem('exitIntentShownAyo', 'true');
                }
            };
            document.addEventListener('mouseout', e => { if (e.clientY < 0 && !e.relatedTarget && !e.toElement) showExitPopup(); });
            document.getElementById('close-exit-popup').addEventListener('click', () => { exitIntentPopup.style.display = 'none'; });
        }
    } // --- FINE BLOCCO IF per la pagina principale
});
// Funzione per caricare la chiave e lo script di Google Maps
async function loadGoogleMapsScript() {
    try {
        // Chiamiamo la Netlify Function per ottenere la chiave in modo sicuro
        const response = await fetch('/.netlify/functions/get-maps-key');
        if (!response.ok) throw new Error("Errore nel fetch della chiave API");
        
        const data = await response.json();
        const apiKey = data.apiKey;

        if (!apiKey) throw new Error("Chiave API di Google Maps non trovata.");

        // Creiamo un nuovo tag <script> e lo aggiungiamo alla pagina
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initAutocomplete`;
        script.async = true;
        document.head.appendChild(script);

    } catch (error) {
        console.error("Impossibile caricare lo script di Google Maps:", error);
    }
}

// ===================================================================
// La funzione initAutocomplete ora deve essere definita a livello globale
// perché viene chiamata dallo script di Google Maps.
// ===================================================================
function initAutocomplete() {
    const addressInput = document.getElementById('address');
    if (!addressInput) return;

    const options = {
        types: ['address'],
        fields: ['address_components', 'name']
    };

    const autocomplete = new google.maps.places.Autocomplete(addressInput, options);
    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.address_components) return;

        document.getElementById('city').value = '';
        document.getElementById('postal-code').value = '';
        document.getElementById('country').value = '';
        addressInput.value = '';

        let streetNumber = '';
        let route = '';

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
}
// La rendiamo globale per essere accessibile dal callback di Google
window.initAutocomplete = initAutocomplete;


// ===== Inizio del resto del codice =====

// Variabili globali per le traduzioni caricate
let i18nData = {
    en: {},
    current: {}
};
let currentLang = localStorage.getItem('language') || 'it';

async function fetchTranslations(lang) {
    try {
        const response = await fetch(`traduzioni/${lang}.json`);
        if (!response.ok) throw new Error(`Non ho potuto caricare ${lang}.json: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('language', lang);
    document.documentElement.lang = lang;

    if (Object.keys(i18nData.en).length === 0) {
        const enTranslations = await fetchTranslations('en');
        if (enTranslations) i18nData.en = enTranslations;
        else {
            console.error("Non sono riuscito a caricare le traduzioni di fallback in Inglese.");
            return;
        }
    }
    i18nData.current = (lang === 'en') ? i18nData.en : (await fetchTranslations(lang) || i18nData.en);
    
    document.querySelectorAll('[data-i18n-key]').forEach(element => {
        const key = element.getAttribute('data-i18n-key');
        let translation = i18nData.current[key] || i18nData.en[key];
        if (key === 'formButtonCompletePay' && selectedPrice > 0) {
            const payButtonText = i18nData.current.formButtonCompletePay || i18nData.en.formButtonCompletePay || "Complete Adoption - Pay €{price}";
            translation = payButtonText.replace('{price}', selectedPrice);
        } else if (key === 'formButtonCompletePay' && selectedPrice === 0) {
             translation = i18nData.current.formButtonCompleteDefault || i18nData.en.formButtonCompleteDefault;
        }
        if (element.tagName === 'LI' && key.includes('Benefit')) element.innerHTML = translation || '';
        else if (element.tagName === 'P' && (key.includes('Answer') || key.includes('whatYouGetImagineText'))) element.innerHTML = translation || '';
        else element.textContent = translation || '';
    });
    document.querySelectorAll('[data-i18n-placeholder-key]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder-key');
        const placeholderTranslation = i18nData.current[key] || i18nData.en[key];
        element.placeholder = placeholderTranslation || '';
    });
    const treeTypeSelect = document.getElementById('tree-type');
    if (treeTypeSelect) {
        treeTypeSelect.querySelector('option[value=""]').textContent = i18nData.current.formSelectTreeType || i18nData.en.formSelectTreeType;
        treeTypeSelect.querySelector('option[value="young"]').textContent = i18nData.current.formTreeYoung || i18nData.en.formTreeYoung;
        treeTypeSelect.querySelector('option[value="mature"]').textContent = i18nData.current.formTreeMature || i18nData.en.formTreeMature;
        treeTypeSelect.querySelector('option[value="centenary"]').textContent = i18nData.current.formTreeCentenary || i18nData.en.formTreeCentenary;
    }
    const countrySelect = document.getElementById('country');
    if (countrySelect) {
        countrySelect.querySelector('option[value=""]').textContent = i18nData.current.formSelectCountry || i18nData.en.formSelectCountry;
        const countries = ["IT", "UK", "DE", "CH", "NO", "SE", "DK", "FR", "ES", "NL", "AT", "BE", "FI"];
        countries.forEach(countryCode => {
            const option = countrySelect.querySelector(`option[value="${countryCode}"]`);
            if (option) option.textContent = i18nData.current[`formCountry${countryCode}`] || i18nData.en[`formCountry${countryCode}`];
        });
    }
    updateTreeSelectionDisplay();
    updateMostPopular();
    updateCharCount();
    checkFormValidity();
}

let selectedTreeType = '';
let selectedPrice = 0;
const clickTracker = {
    young: parseInt(localStorage.getItem('clicks_young') || '0'),
    mature: parseInt(localStorage.getItem('clicks_mature') || '5'),
    centenary: parseInt(localStorage.getItem('clicks_centenary') || '0')
};

function updateMostPopular() {
    document.querySelectorAll('.popular-badge').forEach(badge => badge.remove());
    document.querySelectorAll('.product-card.popular').forEach(card => card.classList.remove('popular'));
    const mostPopularType = Object.keys(clickTracker).reduce((a, b) => clickTracker[a] > clickTracker[b] ? a : b);
    const mostPopularCard = document.querySelector(`.product-card[data-tree-type="${mostPopularType}"]`);
    if (mostPopularCard) {
        mostPopularCard.classList.add('popular');
        const badge = document.createElement('div');
        badge.className = 'popular-badge';
        badge.textContent = (i18nData.current && i18nData.current.productPopularBadge) || (i18nData.en && i18nData.en.productPopularBadge) || "Most Popular";
        mostPopularCard.insertBefore(badge, mostPopularCard.firstChild);
    }
}

function selectTree(treeType) {
    clickTracker[treeType]++;
    localStorage.setItem(`clicks_${treeType}`, clickTracker[treeType].toString());
    updateMostPopular();
    document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
    const selectedCardElement = document.querySelector(`.product-card[data-tree-type="${treeType}"]`);
    if (selectedCardElement) {
        selectedCardElement.classList.add('selected');
        selectedPrice = parseInt(selectedCardElement.dataset.price);
        selectedTreeType = treeType;
        sessionStorage.setItem('selectedTree', treeType);
    }
    const treeSelect = document.getElementById('tree-type');
    treeSelect.value = treeType;
    document.getElementById('selected-tree-price').textContent = `€${selectedPrice}`;
    document.getElementById('summary-price').textContent = `€${selectedPrice}`;
    document.getElementById('total-price').textContent = `€${selectedPrice}`;
    updateTreeSelectionDisplay();
    const formSection = document.getElementById('personalization');
    if (formSection) {
        const navHeight = document.querySelector('.main-nav')?.offsetHeight || 0;
        const elementPosition = formSection.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - navHeight - 20;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
}

function updateTreeSelectionFromForm() {
    const treeSelect = document.getElementById('tree-type');
    const selectedOption = treeSelect.options[treeSelect.selectedIndex];
    if (selectedOption && selectedOption.value) {
        selectedTreeType = selectedOption.value;
        selectedPrice = parseInt(selectedOption.dataset.price);
        sessionStorage.setItem('selectedTree', selectedTreeType);
        document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
        const selectedCardElement = document.querySelector(`.product-card[data-tree-type="${selectedTreeType}"]`);
        if (selectedCardElement) selectedCardElement.classList.add('selected');
        document.getElementById('selected-tree-price').textContent = `€${selectedPrice}`;
        document.getElementById('summary-price').textContent = `€${selectedPrice}`;
        document.getElementById('total-price').textContent = `€${selectedPrice}`;
    } else {
        selectedTreeType = '';
        selectedPrice = 0;
        sessionStorage.removeItem('selectedTree');
        document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
        document.getElementById('selected-tree-price').textContent = '€0';
        document.getElementById('summary-price').textContent = '€0';
        document.getElementById('total-price').textContent = '€0';
    }
    updateTreeSelectionDisplay();
}

function updateTreeSelectionDisplay() {
    const currentTrans = (i18nData.current && Object.keys(i18nData.current).length > 0) ? i18nData.current : i18nData.en;
    if (!currentTrans || Object.keys(currentTrans).length === 0) return;
    const treeNames = {
        'young': (currentTrans.formTreeYoung || "").split(' - ')[0],
        'mature': (currentTrans.formTreeMature || "").split(' - ')[0],
        'centenary': (currentTrans.formTreeCentenary || "").split(' - ')[0]
    };
    const selectedTreeTitleEl = document.getElementById('selected-tree-title');
    const summaryTreeEl = document.getElementById('summary-tree');
    const previewTreeEl = document.getElementById('preview-tree');
    const treeName = selectedTreeType ? treeNames[selectedTreeType] : currentTrans.formSelectedTreeDefault;
    const treeNameForPreview = selectedTreeType ? treeNames[selectedTreeType] : currentTrans.certTreeTypePlaceholder;
    if (selectedTreeTitleEl) selectedTreeTitleEl.textContent = treeName;
    if (summaryTreeEl) summaryTreeEl.textContent = treeName;
    if (previewTreeEl) previewTreeEl.textContent = treeNameForPreview;
    updateCertificatePreview();
    checkFormValidity();
}

function updateCertificatePreview() {
    const currentTrans = (i18nData.current && Object.keys(i18nData.current).length > 0) ? i18nData.current : i18nData.en;
    if (!currentTrans || Object.keys(currentTrans).length === 0) return;
    const firstName = document.getElementById('first-name').value.trim();
    const lastName = document.getElementById('last-name').value.trim();
    const certificateNameInput = document.getElementById('certificate-name').value.trim();
    let displayCertificateName = currentTrans.certYourNamePlaceholder;
    if (certificateNameInput) displayCertificateName = certificateNameInput;
    else if (firstName || lastName) displayCertificateName = `${firstName} ${lastName}`.trim();
    const message = document.getElementById('certificate-message').value.trim() || currentTrans.certMessagePlaceholder;
    const previewNameEl = document.getElementById('preview-name');
    const previewMessageEl = document.getElementById('preview-message');
    if (previewNameEl) previewNameEl.textContent = displayCertificateName;
    if (previewMessageEl) previewMessageEl.textContent = message;
}

function updateCharCount() {
    const currentTrans = (i18nData.current && Object.keys(i18nData.current).length > 0) ? i18nData.current : i18nData.en;
    if (!currentTrans || Object.keys(currentTrans).length === 0) return;
    const textarea = document.getElementById('certificate-message');
    const counter = textarea.parentElement.querySelector('.char-count');
    if (counter) {
         const charCountText = currentTrans.formCharCount;
         counter.textContent = charCountText.replace(/\d+\//, `${textarea.value.length}/`);
    }
}

function checkFormValidity() {
    const currentTrans = (i18nData.current && Object.keys(i18nData.current).length > 0) ? i18nData.current : i18nData.en;
    if (!currentTrans || Object.keys(currentTrans).length === 0) return;
    const requiredFields = document.querySelectorAll('#adoption-form input[required], #adoption-form select[required]');
    const completeBtn = document.getElementById('complete-adoption-btn');
    let allValid = selectedTreeType !== '';
    requiredFields.forEach(field => {
        if (!field.value.trim()) allValid = false;
    });
    if(completeBtn){
        completeBtn.disabled = !allValid;
        let buttonTextKey = allValid ? (selectedPrice > 0 ? 'formButtonCompletePay' : 'formButtonCompleteDefault') : 'formButtonCompleteFields';
        let buttonText = currentTrans[buttonTextKey] || i18nData.en[buttonTextKey];
        if (buttonTextKey === 'formButtonCompletePay') buttonText = buttonText.replace('{price}', selectedPrice);
        completeBtn.textContent = buttonText;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // La mappa viene caricata all'avvio
    loadGoogleMapsScript();

    const handleNetlifyFormSubmit = async (event) => {
        event.preventDefault();
        document.getElementById('form-language').value = currentLang;
        const form = event.target;
        const formData = new FormData(form);
        const successMessage = document.getElementById(form.id + '-success');
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams(formData).toString()
            });
            if (response.ok) {
                if (successMessage) successMessage.classList.add('visible');
                form.reset();
                setTimeout(() => { if (successMessage) successMessage.classList.remove('visible'); }, 5000);
            } else { throw new Error('Network response was not ok.'); }
        } catch (error) {
            console.error('Form submission error:', error);
            alert('Si è verificato un errore, riprova.');
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    };
    const contactForm = document.getElementById('contact-form');
    if (contactForm) contactForm.addEventListener('submit', handleNetlifyFormSubmit);
    const newsletterForm = document.getElementById('newsletter-form');
    if (newsletterForm) newsletterForm.addEventListener('submit', handleNetlifyFormSubmit);

    // --- Inizio del tuo codice originale ---
    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
        languageSelector.value = currentLang;
        languageSelector.addEventListener('change', (event) => setLanguage(event.target.value));
    }
    const heroBgVideo = document.getElementById('heroBgVideo');
    const videoBackgroundDiv = document.querySelector('.video-background');
    if (heroBgVideo && videoBackgroundDiv) {
        heroBgVideo.oncanplay = function() { videoBackgroundDiv.style.backgroundImage = 'none'; };
    }
    await setLanguage(currentLang);
    const storedTreeType = sessionStorage.getItem('selectedTree');
    if (storedTreeType) {
        const treeSelect = document.getElementById('tree-type');
        treeSelect.value = storedTreeType;
        updateTreeSelectionFromForm();
    } else {
        updateTreeSelectionDisplay();
    }
    const formInputs = document.querySelectorAll('#adoption-form input, #adoption-form select, #adoption-form textarea');
    formInputs.forEach(input => {
        const eventType = (input.tagName === 'SELECT' || input.type === 'checkbox') ? 'change' : 'input';
        input.addEventListener(eventType, checkFormValidity);
        if (input.id === 'certificate-name' || input.id === 'certificate-message' || input.id === 'first-name' || input.id === 'last-name') {
            input.addEventListener('input', updateCertificatePreview);
        }
        if (input.id === 'certificate-message') input.addEventListener('input', updateCharCount);
    });
    checkFormValidity();
    const adoptionForm = document.getElementById('adoption-form');
    if (adoptionForm) {
        adoptionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const currentTrans = i18nData.current || i18nData.en;
            checkFormValidity();
            if (document.getElementById('complete-adoption-btn').disabled) {
                alert(currentTrans.alertCompleteFields);
                return;
            }
            alert(currentTrans.alertFormSubmitted);
        });
    }
    const nav = document.querySelector('.main-nav');
    if (nav) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) nav.classList.add('scrolled');
            else nav.classList.remove('scrolled');
            let currentSectionId = 'hero';
            const navHeight = nav.offsetHeight || 0;
            document.querySelectorAll('section[id]').forEach(section => {
                const sectionTop = section.offsetTop - navHeight - 20;
                if (pageYOffset >= sectionTop) currentSectionId = section.getAttribute('id');
            });
            document.querySelectorAll('.nav-links li a').forEach(link => {
                link.classList.toggle('active-link', link.getAttribute('href') === `#${currentSectionId}`);
            });
        });
    }
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', String(isOpen));
        });
    }
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const targetElement = document.querySelector(this.getAttribute('href'));
            if (targetElement) {
                const navHeight = document.querySelector('.main-nav')?.offsetHeight || 0;
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 10;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
                if (navLinks && navLinks.classList.contains('open')) {
                    navLinks.classList.remove('open');
                    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
                }
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
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
    document.querySelectorAll('.faq-question').forEach(q => {
        q.addEventListener('click', () => {
            const answer = q.nextElementSibling;
            const wasActive = q.classList.contains('active');
            document.querySelectorAll('.faq-question').forEach(otherQ => {
                otherQ.classList.remove('active');
                if (otherQ.nextElementSibling) otherQ.nextElementSibling.classList.remove('open');
            });
            if (!wasActive) {
                q.classList.add('active');
                if (answer) answer.classList.add('open');
            }
        });
    });
    (function initSlideshow() {
        let slideIndex = 0;
        const slides = document.querySelectorAll("#gallery .slide");
        const dots = document.querySelectorAll("#gallery .dot");
        if (slides.length === 0) return;
        function showSlides(n) {
            slideIndex = (n + slides.length) % slides.length;
            slides.forEach(slide => slide.style.display = "none");
            dots.forEach(dot => dot.classList.remove("active"));
            slides[slideIndex].style.display = "block";
            dots[slideIndex].classList.add("active");
        }
        window.plusSlides = (n) => showSlides(slideIndex + n);
        window.currentSlide = (n) => showSlides(n - 1);
        showSlides(slideIndex);
    })();
    const cookieBanner = document.getElementById('cookie-banner');
    if (cookieBanner && !localStorage.getItem('cookieConsentAyo')) {
        cookieBanner.style.display = 'block';
        document.getElementById('accept-cookies').addEventListener('click', () => {
            localStorage.setItem('cookieConsentAyo', 'accepted');
            cookieBanner.style.display = 'none';
        });
        document.getElementById('decline-cookies').addEventListener('click', () => {
            localStorage.setItem('cookieConsentAyo', 'declined');
            cookieBanner.style.display = 'none';
        });
    }
    const exitIntentPopup = document.getElementById('exit-intent-popup');
    if (exitIntentPopup) {
        const showExitPopup = () => {
            if (!sessionStorage.getItem('exitIntentShownAyo')) {
                exitIntentPopup.style.display = 'flex';
                sessionStorage.setItem('exitIntentShownAyo', 'true');
            }
        };
        document.addEventListener('mouseout', e => {
            if (e.clientY < 0 && !e.relatedTarget && !e.toElement) showExitPopup();
        });
        document.getElementById('close-exit-popup').addEventListener('click', () => {
            exitIntentPopup.style.display = 'none';
        });
    }
}); 

function resetClickCounters() {
    localStorage.removeItem('clicks_young');
    localStorage.removeItem('clicks_mature');
    localStorage.removeItem('clicks_centenary');
    clickTracker.young = 0;
    clickTracker.mature = 5; 
    clickTracker.centenary = 0;
    updateMostPopular();
    sessionStorage.removeItem('selectedTree');
    const treeTypeSelect = document.getElementById('tree-type');
    if(treeTypeSelect) treeTypeSelect.value = '';
    document.querySelectorAll('.product-card').forEach(card => card.classList.remove('selected'));
    selectedTreeType = '';
    selectedPrice = 0;
    updateTreeSelectionDisplay();
    console.log("Click counters and selection reset.");
}
window.resetClickCounters = resetClickCounters;
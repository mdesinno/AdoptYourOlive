document.addEventListener('DOMContentLoaded', () => {
console.log("JS Caricato");

// 1. RILEVAMENTO LINGUA (Legge il tag <html lang="it">)
    const currentLang = document.documentElement.lang || 'en';
    const isIt = currentLang === 'it';

    // 2. DIZIONARIO TESTI DINAMICI
    const txt = {
        // Messaggi di Caricamento
        sending: isIt ? "Invio..." : "Sending...",
        paymentLoading: isIt ? "Attendi..." : "Loading...",
        
        // Messaggi di Successo/Errore
        successMsg: isIt ? "Messaggio inviato! Ti risponderemo presto." : "Message sent successfully! We'll get back to you soon.",
        // QUI HO AGGIUNTO L'EMAIL:
        errorMsg: isIt ? "Errore nell'invio. Scrivici a: info@adoptyourolive.com" : "Error. Please email us at: info@adoptyourolive.com",
        
        corpSuccess: isIt ? "Richiesta ricevuta! Ti invieremo il preventivo a breve." : "Request received! We'll send you a quote shortly.",
        newsSuccess: isIt ? "Benvenuto in famiglia! Sei iscritto." : "Welcome to the family! You are subscribed.",
        newsError: isIt ? "Qualcosa è andato storto. Riprova." : "Something went wrong. Please try again.",
        promoApplied: isIt ? "Codice applicato!" : "Promo Code applied!",
        
        // Smart Form (Placeholder)
        placeholderName: isIt ? "Mario Rossi" : "John Smith",
        placeholderSurname: isIt ? "Rossi" : "Smith",
        giftRecipientName: isIt ? "Nome Destinatario" : "Recipient's Name",
        giftRecipientSurname: isIt ? "Cognome Destinatario" : "Recipient's Surname",
        hintOwner: isIt ? "Il nome completo dell'adottante." : "The full name of the person adopting the tree.",
        hintGift: isIt ? "Inserisci il nome di chi riceverà il regalo." : "Enter the name of the person receiving the gift."
    };

/* =========================================
   NAVBAR LOGIC (Scroll + Mobile Toggle)
   ========================================= */
const navbar = document.querySelector('.navbar');
const menuIcon = document.querySelector('.mobile-menu-icon');
const navLinks = document.querySelector('.nav-links');

// Controllo sicurezza
if (navbar && menuIcon && navLinks) {

    // Variabile per evitare di ingolfare lo scroll
    let ticking = false;

    // 1. Funzione Scroll (Desktop & Mobile)
    function checkScroll() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
        ticking = false; // Resetta la variabile
    }

    // 2. Funzione Toggle Menu Mobile
    menuIcon.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        navbar.classList.toggle('menu-open');
        
        if (navLinks.classList.contains('active')) {
            menuIcon.textContent = '✕';
        } else {
            menuIcon.textContent = '☰';
        }
    });

    // 3. Chiudi menu se clicco un link
    const allLinks = document.querySelectorAll('.nav-links a');
    allLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            navbar.classList.remove('menu-open');
            menuIcon.textContent = '☰';
        });
    });

    // Ascolta lo scroll ottimizzato
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(checkScroll);
            ticking = true;
        }
    });
    
    // Esegui subito, ma senza forzare il blocco del rendering
    window.requestAnimationFrame(checkScroll);
    
} else {
    console.error("ERRORE: Elementi Navbar non trovati");
}

    
    /* =========================================
   1. GESTIONE MODALE ADOZIONE (Aggiornato per Stripe)
   ========================================= */
const adoptionModal = document.getElementById('adoption-modal');
const hiddenKitInput = document.getElementById('selected-kit-id'); // L'input nascosto che abbiamo messo nel form
const productNameDisplay = document.getElementById('modal-product-name'); // Se hai un titolo H2/H3 nella modale per il nome prodotto

// Funzione chiamata dai bottoni nell'HTML: openAdoptionModal('Nome', 'id-tecnico')
window.openAdoptionModal = (productName, technicalId) => {
    if (adoptionModal) {
        // 1. Scrive il nome del prodotto (Visivo)
        // Se nella modale non hai un id="modal-product-name", questa riga verrà ignorata senza errori
        if(productNameDisplay) productNameDisplay.textContent = productName;

        // 2. Scrive l'ID tecnico nell'input nascosto (FONDAMENTALE)
        if(hiddenKitInput) {
            hiddenKitInput.value = technicalId;
        } else {
            console.error("ERRORE: Non trovo l'input id='selected-kit-id' nel form!");
        }

        adoptionModal.showModal();
    }
    // Tracciamento Google GA4 e Google Ads
if (typeof window.gtag === 'function') {
    window.gtag('event', 'begin_checkout', {
        items: [{
            item_name: productName, // o kitName, a seconda di come hai chiamato la variabile
            item_id: technicalId
        }]
    });
}
// Tracciamento Meta (Facebook)
if (typeof window.fbq === 'function') {
    window.fbq('track', 'InitiateCheckout');
}
};

window.closeModal = () => {
    if (adoptionModal) adoptionModal.close();
};

// Chiudi cliccando fuori
if (adoptionModal) {
    adoptionModal.addEventListener('click', (e) => {
        const dims = adoptionModal.getBoundingClientRect();
        if (
            e.clientX < dims.left || e.clientX > dims.right ||
            e.clientY < dims.top || e.clientY > dims.bottom
        ) {
            adoptionModal.close();
        }
    });
}

/* =========================================
   2. LOGICA "SMART FORM" (Nome Diviso + Regalo)
   ========================================= */
const firstNameInput = document.getElementById('buyer-firstname');
const lastNameInput = document.getElementById('buyer-lastname');

const certInput = document.getElementById('cert-name');
const labelInput = document.getElementById('label-name');
const giftCheckbox = document.getElementById('is-gift');
const giftMessageContainer = document.getElementById('gift-message-container'); // <--- NUOVO

// Flags: Se l'utente tocca un campo, smettiamo di autocompilarlo
let certManuallyChanged = false;
let labelManuallyChanged = false;

if (firstNameInput && lastNameInput && certInput && labelInput && giftCheckbox) {
    
    // Funzione unica che aggiorna i campi
    function updateSmartFields() {
        // Se è regalo, NON fare nulla (i campi devono restare vuoti o manuali)
        if (giftCheckbox.checked) return;

        const fName = firstNameInput.value.trim();
        const lName = lastNameInput.value.trim();

        // 1. Certificato = Nome + Cognome
        if (!certManuallyChanged) {
            certInput.value = (fName + " " + lName).trim();
        }

        // 2. Etichetta = Solo Cognome
        if (!labelManuallyChanged) {
            labelInput.value = lName;
        }
    }

    // Ascoltiamo entrambi i campi nome/cognome
    firstNameInput.addEventListener('input', updateSmartFields);
    lastNameInput.addEventListener('input', updateSmartFields);

    // LOGICA REGALO (Svuota tutto e Mostra Messaggio)
    giftCheckbox.addEventListener('change', (e) => {
        const isGift = e.target.checked;
        const hint = document.getElementById('cert-hint');
        
        // 1. Mostra/Nascondi la Textarea per il bigliettino
        if (giftMessageContainer) {
            giftMessageContainer.style.display = isGift ? 'block' : 'none';
        }

        if (isGift) {
            // --- MODALITÀ REGALO ATTIVA ---
            if (!certManuallyChanged) {
                certInput.value = '';
                certInput.setAttribute('placeholder', txt.giftRecipientName); // Usa variabile
            }
            if (!labelManuallyChanged) {
                labelInput.value = '';
                labelInput.setAttribute('placeholder', txt.giftRecipientSurname); // Usa variabile
            }
            if(hint) hint.textContent = txt.hintGift; // Usa variabile

        } else {
            // --- MODALITÀ REGALO DISATTIVATA ---
            // Qui c'era il problema: prima rimetteva "John Smith" anche in Italia
            certInput.setAttribute('placeholder', txt.placeholderName); 
            labelInput.setAttribute('placeholder', txt.placeholderSurname); 
            
            updateSmartFields();
            
            if(hint) hint.textContent = txt.hintOwner;
            
            const msgInput = document.getElementById('gift-message');
            if(msgInput) msgInput.value = ''; 
        }
    });

    // Se l'utente modifica manualmente i campi target, disattiviamo l'automazione per quel campo
    certInput.addEventListener('input', () => { certManuallyChanged = true; });
    labelInput.addEventListener('input', () => { labelManuallyChanged = true; });
}


    /* =========================================
   3. GESTIONE CODICI SCONTO (URL & INPUT)
   ========================================= */
// A. Logica Mostra/Nascondi Campo Sconto
const toggleDiscountBtn = document.getElementById('toggle-discount-btn');
const discountContainerDiv = document.getElementById('discount-container');

if (toggleDiscountBtn && discountContainerDiv) {
    toggleDiscountBtn.addEventListener('click', function(e) {
        e.preventDefault();
        discountContainerDiv.style.display = 'block';
        this.style.display = 'none'; // Fa sparire il link dopo il click
    });
}

// B. Logica Sconto da URL (?discount=PROMO)
const urlParams = new URLSearchParams(window.location.search);
const discountFromUrl = urlParams.get('discount'); 

const discountInput = document.getElementById('discount-code');
const discountMsg = document.getElementById('discount-message');

if (discountFromUrl && discountInput) {
    const cleanCode = discountFromUrl.toUpperCase().trim();
    discountInput.value = cleanCode;
    
    // Mostriamo subito il contenitore se c'è un codice nell'URL
    if (discountContainerDiv) discountContainerDiv.style.display = 'block';
    if (toggleDiscountBtn) toggleDiscountBtn.style.display = 'none';
    
    // Feedback Visivo
    discountInput.style.borderColor = 'var(--primary-green)';
    discountInput.style.backgroundColor = '#f0f9eb'; 
    if(discountMsg) {
        discountMsg.style.display = 'block';
        discountMsg.textContent = `${txt.promoApplied} (${cleanCode})`;
    }
}


    /* =========================================
   4. INVIO CHECKOUT (STRIPE)
   ========================================= */
const adoptForm = document.getElementById('adoption-form');

if (adoptForm) {
    adoptForm.addEventListener('submit', async (e) => {
        e.preventDefault(); 

        const submitBtn = adoptForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        submitBtn.textContent = txt.paymentLoading;
        submitBtn.disabled = true;

        const formData = new FormData(adoptForm);
        const kitId = document.getElementById('selected-kit-id').value;

        // --- CORREZIONE QUI SOTTO ---
        // Le chiavi (a sinistra) devono essere UGUALI a quelle che la function si aspetta
        const data = {
            kitId: kitId,
            buyerFirstName: formData.get('buyerFirstName'), // Era: buyerName
            buyerLastName: formData.get('buyerLastName'),   // Era: buyerSurname
            email: formData.get('email'),
            lang: formData.get('lang') || 'en',
            isGift: formData.get('isGift') === 'on',
            giftMessage: formData.get('giftMessage'),
            certName: formData.get('certName'),
            labelName: formData.get('labelName'),
            discountCode: formData.get('discountCode')
        };
        // ----------------------------

        try {
            const response = await fetch('/.netlify/functions/checkout', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (response.ok) {
                window.location.href = result.url;
            } else {
                // Mostra l'errore specifico che arriva dal server
                throw new Error(result.error || 'Errore nel checkout');
            }

        } catch (error) {
            console.error(error);
            alert("Errore: " + error.message);
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}

    /* =========================================
   5. GESTIONE MODALE CORPORATE (Logica Completa + Backend)
   ========================================= */
const corpModal = document.getElementById('corporate-modal');
const corpForm = document.getElementById('corporate-form');
const corpBtn = document.getElementById('corp-btn'); // Assicurati che il bottone nel form abbia id="corp-btn"

// --- APERTURA E CHIUSURA (Logica Vecchia mantenuta) ---

window.openCorporateModal = () => {
    if (corpModal) corpModal.showModal();
};

window.closeCorporateModal = () => {
    if (corpModal) corpModal.close();
};

// Chiudi cliccando fuori (sullo sfondo grigio)
if (corpModal) {
    corpModal.addEventListener('click', (e) => {
        if (e.target === corpModal) {
            corpModal.close();
        }
    });
}

// --- INVIO DEL FORM (Logica Nuova collegata al Backend) ---

if (corpForm) {
    corpForm.addEventListener('submit', async (e) => {
        // 1. BLOCCO IL REFRESH
        e.preventDefault(); 
        
        // 2. UX: Bottone in caricamento
        const originalText = corpBtn ? corpBtn.textContent : "Invia";
        if (corpBtn) {
            corpBtn.textContent = txt.sending;
            corpBtn.disabled = true;
        }

        // 3. RACCOLTA DATI DAL FORM
        const formData = new FormData(corpForm);
        
        // Costruiamo l'oggetto da mandare alla Function
        const data = {
            name: formData.get('name'),
            email: formData.get('email'),
            lang: formData.get('lang') || 'en', // Default inglese se manca
            event_type: formData.get('eventType'), // Nota: corrisponde al name nell'HTML
            quantity: formData.get('quantity'),
            message: formData.get('message'),
        };

        try {
            // 4. CHIAMATA AL SERVER (Netlify Function)
            const response = await fetch('/.netlify/functions/favors', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                // SUCCESSO
                alert(txt.corpSuccess);
                corpForm.reset(); // Pulisce i campi
                closeCorporateModal(); // Chiude la modale
            } else {
                // ERRORE DEL SERVER
                throw new Error('Errore durante il salvataggio');
            }
        } catch (error) {
            // ERRORE DI RETE O ALTRO
            console.error('Errore invio form:', error);
            alert(txt.errorMsg);
        } finally {
            // 5. RIPRISTINO BOTTONE (Sia se va bene, sia se va male)
            if (corpBtn) {
                corpBtn.textContent = originalText;
                corpBtn.disabled = false;
            }
        }
    });
}


/* =========================================
       LOGICA FAQ COMPLETA (Sezione + Domande)
       ========================================= */

    // 1. GESTIONE TITOLO PRINCIPALE (Apre/Chiude tutta la sezione)
    const faqMainHeader = document.querySelector('.toggle-header');
    
    if (faqMainHeader) {
        faqMainHeader.addEventListener('click', function() {
            // Ruota la freccia del titolo
            this.classList.toggle('active');
            
            // Trova il wrapper nascosto subito sotto
            const wrapper = this.nextElementSibling;
            if (wrapper) {
                wrapper.classList.toggle('open');
                
                // EVENTO DI TRACCIAMENTO (Solo se si sta aprendo)
                if (wrapper.classList.contains('open')) {
                    if (typeof window.gtag === 'function') {
                        window.gtag('event', 'select_content', {
                            content_type: 'faq',
                            content_id: 'sezione_faq_aperta'
                        });
                    }
                }
            }
        });
    }

    // 2. GESTIONE SINGOLE DOMANDE (Accordion interno)
    const faqQuestions = document.querySelectorAll('.accordion-header');

    faqQuestions.forEach(btn => {
        btn.addEventListener('click', function(e) {
            // Evita che il click risalga fino al titolo principale
            e.stopPropagation();

            const item = this.parentElement;         // Il div .accordion-item
            const content = this.nextElementSibling; // Il div .accordion-content
            
            // A. CHIUDI TUTTE LE ALTRE (Logica esclusiva)
            document.querySelectorAll('.accordion-item').forEach(otherItem => {
                if (otherItem !== item) {
                    otherItem.classList.remove('active'); // Resetta il +
                    const otherContent = otherItem.querySelector('.accordion-content');
                    if (otherContent) {
                        otherContent.classList.remove('open');
                        otherContent.style.maxHeight = null;
                    }
                }
            });

            // B. APRI/CHIUDI QUELLA CLICCATA
            if (item.classList.contains('active')) {
                // Se era aperta, chiudi
                item.classList.remove('active');
                content.classList.remove('open');
                content.style.maxHeight = null;
            } else {
                // Se era chiusa, apri
                item.classList.add('active');
                content.classList.add('open');
                // Calcola l'altezza esatta per l'animazione smooth
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    });

    // Configurazione
    const AUTOPLAY_SPEED = 4000; // ms (4 secondi)

    // Inizializza tutti gli slider trovati
    const sliders = document.querySelectorAll('.slider-wrapper');

    sliders.forEach(slider => {
        const track = slider.querySelector('.slider-track');
        const slides = Array.from(track.children);
        const nextBtn = slider.querySelector('.next-btn');
        const prevBtn = slider.querySelector('.prev-btn');
        
        let currentIndex = 0;
        let autoPlayInterval;
        let isTouching = false; // Variabile per sapere se l'utente sta toccando
        
        // Capire quante slide vedo contemporaneamente (1 su mobile, 3 su desktop)
        // Usiamo Math.round per gestire le approssimazioni del browser
        const getVisibleSlides = () => {
            return Math.round(slider.querySelector('.slider-track-container').offsetWidth / slides[0].offsetWidth);
        };

        const updateSliderPosition = () => {
            const slideWidth = slides[0].offsetWidth;
            
            if (window.innerWidth <= 900) {
                // MOBILE: Usiamo lo scroll nativo, così non blocchiamo il dito
                const container = slider.querySelector('.slider-track-container');
                container.scrollTo({
                    left: slideWidth * currentIndex,
                    behavior: 'smooth'
                });
            } else {
                // DESKTOP: Usiamo transform come prima
                track.style.transform = 'translateX(-' + (slideWidth * currentIndex) + 'px)';
            }
        };

        const moveToNextSlide = () => {
            const visibleSlides = getVisibleSlides();
            const maxIndex = slides.length - visibleSlides;

            if (currentIndex >= maxIndex) {
                currentIndex = 0; // Torna all'inizio (Loop)
            } else {
                currentIndex++;
            }
            updateSliderPosition();
        };

        const moveToPrevSlide = () => {
            const visibleSlides = getVisibleSlides();
            const maxIndex = slides.length - visibleSlides;

            if (currentIndex <= 0) {
                currentIndex = maxIndex; // Va alla fine
            } else {
                currentIndex--;
            }
            updateSliderPosition();
        };

        // Event Listeners Frecce
        nextBtn.addEventListener('click', () => {
            moveToNextSlide();
            resetAutoplay();
        });

        prevBtn.addEventListener('click', () => {
            moveToPrevSlide();
            resetAutoplay();
        });

        // Autoplay Logic
        const startAutoplay = () => {
            // Se l'utente sta toccando, NON far partire il timer
            if (isTouching) return; 
            
            stopAutoplay(); // Pulisce eventuali vecchi timer
            autoPlayInterval = setInterval(moveToNextSlide, AUTOPLAY_SPEED);
        };

        const stopAutoplay = () => {
            clearInterval(autoPlayInterval);
        };

        const resetAutoplay = () => {
            stopAutoplay();
            startAutoplay();
        };

        // Ferma autoplay se il mouse è sopra (UX friendly)
        slider.addEventListener('mouseenter', stopAutoplay);
        slider.addEventListener('mouseleave', startAutoplay);

        // GESTIONE STANDBY SU MOBILE
        const container = slider.querySelector('.slider-track-container');

        // 1. Dito appoggiato: Ferma tutto e segna che stai toccando
        container.addEventListener('touchstart', () => {
            isTouching = true;
            stopAutoplay();
        }, { passive: true });

        // 2. Dito alzato: Aspetta un attimo e riavvia l'autoplay
        container.addEventListener('touchend', () => {
            isTouching = false;
            startAutoplay();
        }, { passive: true });

        // 3. (Opzionale) Sincronizza l'indice se l'utente ha scrollato a mano
        container.addEventListener('scroll', () => {
            if (window.innerWidth <= 900 && isTouching) {
                // Calcola quale slide stiamo guardando mentre scrolliamo a mano
                const slideWidth = slides[0].offsetWidth;
                const scrollPos = container.scrollLeft;
                // Aggiorna l'indice senza muovere nulla (così al prossimo scatto parte da qui)
                currentIndex = Math.round(scrollPos / slideWidth);
            }
        }, { passive: true });

        // Gestione ridimensionamento finestra (ricalcola posizioni)
        window.addEventListener('resize', () => {
            updateSliderPosition();
        });

        // Avvio iniziale
        startAutoplay();
    });

    /* =========================================
   NEWSLETTER SUBMISSION (Collegato a Google Sheet)
   ========================================= */
const newsletterForm = document.getElementById('newsletter-form');
const newsletterFeedback = document.getElementById('newsletter-feedback');
const newsletterBtn = document.getElementById('newsletter-btn');

if (newsletterForm) {
    newsletterForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Ferma il ricaricamento della pagina

        // Effetto caricamento
        const originalBtnText = newsletterBtn.textContent;
        newsletterBtn.textContent = txt.sending;
        newsletterBtn.disabled = true;
        newsletterFeedback.style.display = 'none';

        // Raccogli i dati
        const formData = new FormData(newsletterForm);
        const data = {
            email: formData.get('email'),
            lang: formData.get('lang'),
            privacy: formData.get('privacy') === 'on' // Converte checkbox in true
        };

        try {
            // CHIAMA LA TUA FUNZIONE
            const response = await fetch('/.netlify/functions/newsletter', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                // SUCCESSO
                newsletterForm.reset();
                newsletterFeedback.style.color = '#4CAF50'; // Verde
                newsletterFeedback.textContent = txt.newsSuccess;
                newsletterFeedback.style.display = 'block';
            } else {
                // ERRORE LATO SERVER
                throw new Error('Server error');
            }
        } catch (error) {
            // ERRORE DI RETE
            console.error(error);
            newsletterFeedback.style.color = '#ff6b6b'; // Rosso
            newsletterFeedback.textContent = txt.newsError;
            newsletterFeedback.style.display = 'block';
        } finally {
            // Ripristina bottone
            newsletterBtn.textContent = originalBtnText;
            newsletterBtn.disabled = false;
        }
    });
}

/* =========================================
   CONTACT FORM SUBMISSION (General)
   ========================================= */
const contactForm = document.getElementById('contact-form');
const contactBtn = document.getElementById('contact-btn');

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. UX: Feedback visivo
        const originalText = contactBtn.textContent;
        contactBtn.textContent = txt.sending;
        contactBtn.disabled = true;

        // 2. Raccolta Dati
        const formData = new FormData(contactForm);
        const data = {
            name: formData.get('name'),
            email: formData.get('email'),
            lang: formData.get('lang') || 'en',
            message: formData.get('message')
            // Non serve inviare 'privacy' perché è implicita col click
        };

        try {
            // 3. Invio al Backend
            const response = await fetch('/.netlify/functions/messages', {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                alert(txt.successMsg);
                contactForm.reset();
            } else {
                throw new Error('Server Error');
            }
        } catch (error) {
            console.error('Errore invio messaggi:', error);
            alert(txt.errorMsg);
        } finally {
            // 4. Ripristino
            contactBtn.textContent = originalText;
            contactBtn.disabled = false;
        }
    });
}
});


/* =========================================
   6. GDPR COOKIE CONSENT MANAGER (Complete)
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
    
    const cookieBanner = document.getElementById('cookie-banner');
    const cookieModal = document.getElementById('cookie-modal');
    const consentKey = 'ayo_cookie_consent_v1'; 
    
    // --- FUNZIONE CENTRALE: CARICA GLI SCRIPT IN BASE AL CONSENSO ---
    function loadScriptsBasedOnConsent(consentData) {
        console.log("GDPR: Checking consents...", consentData);

        // 1. GESTIONE ANALYTICS (Google Analytics 4 + Google Ads + Clarity)
if (consentData.analytics) {
    if (!document.getElementById('ga4-script')) {
        console.log("Loading Google Analytics, ADS and Clarity..."); // LASCIAMO LA TUA STRINGA ORIGINALE
        
        const gaScript = document.createElement('script');
        gaScript.id = 'ga4-script';
        // Usiamo l'ID di Google Ads come sorgente principale perché è più completo
        gaScript.src = "https://www.googletagmanager.com/gtag/js?id=AW-16812891333"; 
        gaScript.async = true;
        document.head.appendChild(gaScript);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        
        // Configuriamo entrambi: sia Analytics che Google Ads
        gtag('config', 'G-FE1BSWKNP8', { 'anonymize_ip': true });
        gtag('config', 'AW-16812891333'); 
    }

    // --- INSERIMENTO MICROSOFT CLARITY ---
            // Aggiungiamo un check per non caricarlo due volte
            if (!window.clarity) {
                (function(c,l,a,r,i,t,y){
                    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "wbga1guicq");
            }
}

        // 2. GESTIONE MARKETING (Facebook & TikTok)
        if (consentData.marketing) {
            console.log("Loading Marketing Pixels...");

            // --- A. META PIXEL (Facebook/Instagram) ---
            const META_PIXEL_ID = '1636864481057719'; 

            if (META_PIXEL_ID && !document.getElementById('fb-pixel')) {
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                
                fbq('init', META_PIXEL_ID);
                fbq('track', 'PageView'); 
                
                // --- TRACCIAMENTO ACQUISTO DINAMICO ---
                if (window.location.href.includes('success')) {
                    // 1. Legge il valore reale dall'URL (es. ?amount=49.00)
                    const urlParams = new URLSearchParams(window.location.search);
                    const amountParam = urlParams.get('amount');
                    
                    // 2. Se c'è un valore usa quello, altrimenti stima 69
                    const realValue = amountParam ? parseFloat(amountParam) : 79.00;

                    console.log(`Purchase Tracked: €${realValue}`);
                    
                    fbq('track', 'Purchase', { 
                        currency: "EUR", 
                        value: realValue 
                    });
                }
                // -------------------------------------------------------------

                const marker = document.createElement('div'); 
                marker.id = 'fb-pixel'; marker.style.display = 'none';
                document.body.appendChild(marker);
            }

            // --- B. TIKTOK PIXEL (Ora attivo!) ---
            const TIKTOK_PIXEL_ID = 'D5FRT9BC77U2JQE9TDQ0'; // <--- IL TUO ID

            if (TIKTOK_PIXEL_ID && !document.getElementById('tt-pixel')) {
                !function (w, d, t) {
w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};                  
                  ttq.load(TIKTOK_PIXEL_ID);
                  ttq.page();
                  
                  // TRACCIAMENTO ACQUISTO TIKTOK (CompletePayment)
                  if (window.location.href.includes('success')) {
                      const urlParams = new URLSearchParams(window.location.search);
                      const amountParam = urlParams.get('amount');
                      const realValue = amountParam ? parseFloat(amountParam) : 79.00;
                      
                      ttq.track('CompletePayment', {
                          content_type: 'product',
                          quantity: 1,
                          description: 'Olive Tree Adoption',
                          value: realValue,
                          currency: 'EUR'
                      });
                  }

                }(window, document, 'ttq');

                const marker = document.createElement('div'); 
                marker.id = 'tt-pixel'; document.body.appendChild(marker);
            }

            // --- C. GOOGLE ADS CONVERSION (Tracciamento Acquisto) ---
// --- C. GOOGLE ADS CONVERSION (Tracciamento Acquisto) ---
if (window.location.href.includes('success')) {
    const urlParams = new URLSearchParams(window.location.search);
    const amountParam = urlParams.get('amount');
    const realValue = amountParam ? parseFloat(amountParam) : 79.00;

    // Funzione di emergenza: se gtag non è ancora pronta, riprova dopo 1 secondo
    const sendGoogleConversion = () => {
        if (typeof gtag === 'function') {
            console.log(`Google Ads Purchase Tracked: €${realValue}`);
            gtag('event', 'conversion', {
                'send_to': 'AW-16812891333/v-ayCK_O9ZEaEMX_qs8-',
                'value': realValue,
                'currency': 'EUR',
                'transaction_id': urlParams.get('session_id') || '' // Aggiunto per evitare doppioni
            });
        } else {
            console.log("Gtag non ancora pronta, riprovo tra 1s...");
            setTimeout(sendGoogleConversion, 1000);
        }
    };

    sendGoogleConversion();
}
        }
    }

    // --- CONTROLLO INIZIALE ---
    const savedConsent = localStorage.getItem(consentKey);

    if (!savedConsent) {
        if (cookieBanner) setTimeout(() => { cookieBanner.style.display = 'flex'; }, 1000);
    } else {
        const consentData = JSON.parse(savedConsent);
        loadScriptsBasedOnConsent(consentData);

        // AGGIORNAMENTO VISIVO DEGLI INTERRUTTORI NELLA MODALE
        const analyticsToggle = document.getElementById('consent-analytics');
        const marketingToggle = document.getElementById('consent-marketing');
        if (analyticsToggle) analyticsToggle.checked = consentData.analytics;
        if (marketingToggle) marketingToggle.checked = consentData.marketing;
    }

    // --- GESTIONE BOTTONI ---
    const acceptBtn = document.getElementById('cookie-accept');
    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            const consentData = { necessary: true, analytics: true, marketing: true, timestamp: new Date() };
            localStorage.setItem(consentKey, JSON.stringify(consentData));
            if(cookieBanner) cookieBanner.style.display = 'none';
            loadScriptsBasedOnConsent(consentData);
        });
    }

    const rejectBtn = document.getElementById('cookie-reject');
    if (rejectBtn) {
        rejectBtn.addEventListener('click', () => {
            const consentData = { necessary: true, analytics: false, marketing: false, timestamp: new Date() };
            localStorage.setItem(consentKey, JSON.stringify(consentData));
            if(cookieBanner) cookieBanner.style.display = 'none';
        });
    }

    const customBtn = document.getElementById('cookie-customize');
    if (customBtn) {
        customBtn.addEventListener('click', () => { 
            if(cookieModal) cookieModal.showModal(); 
        });
    }
    
    const savePrefBtn = document.getElementById('save-preferences');
    if (savePrefBtn) {
        savePrefBtn.addEventListener('click', () => {
            const analyticsConsent = document.getElementById('consent-analytics').checked;
            const marketingConsent = document.getElementById('consent-marketing').checked;
            
            const consentData = { necessary: true, analytics: analyticsConsent, marketing: marketingConsent, timestamp: new Date() };
            localStorage.setItem(consentKey, JSON.stringify(consentData));
            
            if(cookieModal) cookieModal.close();
            if(cookieBanner) cookieBanner.style.display = 'none';
            
            loadScriptsBasedOnConsent(consentData);
        });
    }
});

function closeCookieModal() {
    const m = document.getElementById('cookie-modal');
    if(m) m.close();
}

function toggleKit(headerElement) {
    // 1. Identifichiamo il contenuto e la freccia della card che abbiamo cliccato
    const content = headerElement.nextElementSibling;
    const isOpening = !content.classList.contains('open'); // Stiamo per aprire?

    // 2. PRIMA CHIUDIAMO TUTTI GLI ALTRI (Reset)
    // Troviamo tutti i contenuti aperti
    document.querySelectorAll('.kit-dropdown-content.open').forEach(el => {
        el.classList.remove('open');
    });
    // Resettiamo tutte le frecce
    document.querySelectorAll('.kit-toggle-header.active').forEach(el => {
        el.classList.remove('active');
    });

    // 3. ORA APRIAMO SOLO QUELLO CLICCATO (Se non era già aperto)
    if (isOpening) {
        content.classList.add('open');
        headerElement.classList.add('active');
        // Da inserire dentro l'if (isOpening) della funzione toggleKit
if (typeof window.gtag === 'function') {
    window.gtag('event', 'view_item_list', {
        item_list_name: 'Dettagli Kit Aperti'
    });
}
    }
}

// --- GESTIONE READ MORE (Versione Multilingua) ---
document.addEventListener("DOMContentLoaded", () => {
    const readMoreBtns = document.querySelectorAll('.read-more-btn');

    readMoreBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const content = this.previousElementSibling;
            content.classList.toggle('expanded');
            
            // Controlla il testo attuale per decidere la lingua
            const currentText = this.textContent.trim();

            if (content.classList.contains('expanded')) {
                // Se stiamo aprendo:
                if (currentText === "Leggi tutto") {
                    this.textContent = "Leggi meno";
                } else {
                    this.textContent = "Read Less";
                }
            } else {
                // Se stiamo chiudendo:
                if (currentText === "Leggi meno") {
                    this.textContent = "Leggi tutto";
                } else {
                    this.textContent = "Read More";
                }
            }
        });
    });
});

/* =========================================
   7. FUNZIONI GLOBALI CHIAMATE DALL'HTML
   ========================================= */
window.toggleShippingNote = function() {
    // Cerchiamo quale radio button è attualmente selezionato
    const checkedOption = document.querySelector('input[name="shipTarget"]:checked');
    const noteBox = document.getElementById('shipping-note-them');
    
    // Se gli elementi esistono (siamo in una pagina con la modale)
    if (checkedOption && noteBox) {
        // Se il valore è 'them' (destinatario), mostra la nota, altrimenti nascondila
        const isDirect = checkedOption.value === 'them';
        noteBox.style.display = isDirect ? 'block' : 'none';
    }
};

/* =========================================
   8. LOGICA SHOP E VERIFICA VIP ADOPTERS
   ========================================= */

// Funzione agganciata al bottone "Apply"
window.verifyMemberId = async function() {
    const inputField = document.getElementById('member-id-input');
    const feedbackText = document.getElementById('adopter-feedback');
    if (!inputField || !feedbackText) return;

    let memberId = inputField.value.trim();
    if (!memberId) return;

    inputField.disabled = true;
    feedbackText.style.display = 'block';
    feedbackText.style.color = '#555';
    feedbackText.innerText = (document.documentElement.lang === 'it') ? 'Verifica in corso...' : 'Verifying...';

    try {
        const response = await fetch('/.netlify/functions/check-vip', {
            method: 'POST',
            body: JSON.stringify({ memberId: memberId })
        });

        const result = await response.json();

        if (result.valid) {
            const expirationTime = new Date(result.expiration).getTime();
            localStorage.setItem('ayo_vip_id', memberId);
            localStorage.setItem('ayo_vip_expiration', expirationTime);
            
            feedbackText.style.color = '#2c5e2e';
            feedbackText.innerText = (document.documentElement.lang === 'it') ? 'Welcome back! Listino esclusivo sbloccato.' : 'Welcome back! Exclusive pricing unlocked.';
            
            window.applyVipPrices();
        } else {
            feedbackText.style.color = '#d32f2f';
            feedbackText.innerText = (document.documentElement.lang === 'it') ? 'Codice non valido o scaduto.' : 'Invalid or expired code.';
            localStorage.removeItem('ayo_vip_id');
            localStorage.removeItem('ayo_vip_expiration');
        }
    } catch (error) {
        feedbackText.style.color = '#d32f2f';
        feedbackText.innerText = (document.documentElement.lang === 'it') ? 'Errore di connessione. Riprova.' : 'Connection error. Please try again.';
    } finally {
        inputField.disabled = false;
    }
};

// Funzione visiva per tagliare i prezzi vecchi
window.applyVipPrices = function() {
    document.querySelectorAll('.normal-price').forEach(el => {
        el.style.textDecoration = 'line-through';
        el.style.color = '#999';
        el.style.fontSize = '0.9em';
    });
    document.querySelectorAll('.adopter-price').forEach(el => {
        el.style.display = 'inline-block';
        el.style.marginLeft = '10px';
    });
    
    const accessStrip = document.querySelector('.shop-access-strip');
    if (accessStrip) accessStrip.style.display = 'none';
};

// Controllo silenzioso al caricamento della pagina Shop
document.addEventListener('DOMContentLoaded', () => {
    const vipExpiration = localStorage.getItem('ayo_vip_expiration');
    const vipId = localStorage.getItem('ayo_vip_id');

    // Assicuriamoci di essere sulla pagina shop prima di agire sul DOM
    const isShopPage = document.querySelector('.products-grid') !== null;

    if (vipId && vipExpiration && isShopPage) {
        const now = new Date().getTime();
        if (now < parseInt(vipExpiration)) {
            window.applyVipPrices();
        } else {
            localStorage.removeItem('ayo_vip_id');
            localStorage.removeItem('ayo_vip_expiration');
        }
    }
    // 2. Ascolto del tasto Invio sull'input del Member ID
    const memberInput = document.getElementById('member-id-input');
    if (memberInput) {
        memberInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault(); // Evita comportamenti di default del browser
                window.verifyMemberId();
            }
        });
    }
});

/* =========================================
   14. LA BOTTEGA - CAROSELLO E CARRELLO
   ========================================= */

// --- DATI CATALOGO BOTTEGA (INGLESE) ---
const CATALOG_EN = {
    'bundle-base': {
        name: 'The Tasting Box (6 pcs)',
        price: 69,
        vipPrice: 54,
        img: '/immagini/box-base.webp',
        desc: `An authentic taste of Puglia. A carefully selected introduction to our traditional pantry.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>1x Sun-dried Tomatoes in olive oil</li>
                   <li>1x Grilled Artichokes</li>
                   <li>1x Grilled Lampascioni</li>
                   <li>1x Bomba Pugliese (Spicy Spread)</li>
                   <li>1x Black Olive Cream</li>
                   <li>1x Mandarin Marmalade</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Sun-dried Tomatoes', 
                text: `Sun-dried tomatoes flavored with typical Mediterranean spices for an even more intense taste. Excellent as an appetizer, side dish, for pasta and pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Sun-dried tomatoes 63%, olive oil 34%, salt, capers, garlic, chili pepper, mint, wine vinegar. Acidity regulator: citric acid.<br>
                <strong>Values (100g):</strong> 169 Kcal | Fat 9.3g | Carbs 16g | Protein 3.5g | Salt 3.2g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Grilled Artichokes', 
                text: `Artichokes grilled on red-hot lava stones, flavored with natural local spices and preserved in olive oil. Excellent for appetizers and sandwiches.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian artichokes 63%, olive oil 34%, garlic, chili pepper, oregano, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.2g | Protein 1.8g | Salt 1.7g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Grilled Lampascioni', 
                text: `Wild onions grilled on red-hot lava stones and flavored with Mediterranean spices. A true, authentic Apulian specialty.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Lampascioni 63%, olive oil 34%, garlic, chili pepper, parsley, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 54 Kcal | Fat 3.7g | Carbs 4.0g | Protein 0.8g | Salt 1.5g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese', 
                text: `A bold, spicy spread born from the union of peppers, eggplants, red carrots, and chili peppers. Ideal for crostini, bruschetta, or pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Vegetables 60% (peppers, eggplants, red carrots, chili pepper), olive oil 37%, garlic, wine vinegar, salt. Citric acid.<br>
                <strong>Values (100g):</strong> 306 Kcal | Fat 32g | Carbs 3.7g | Protein 0.7g | Salt 2.3g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Black Olive Cream', 
                text: `A paté with the intense flavor of local black olives, expressing a typical Apulian taste. Ideal for salads, meat, pasta, and crostini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Black olives 89%, olive oil 9%. Acidity regulator: citric acid.<br>
                <strong>Values (100g):</strong> 189 Kcal | Fat 18g | Carbs 1.5g | Protein 0.8g | Salt 2.8g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Mandarin Marmalade', 
                text: `Preserves all the nutritional properties of seasonal mandarins; with an excellent balance between sweet and bitter, perfect to start the day.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian mandarins 55%, sugar, mandarin peel. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 227 Kcal | Fat 0g | Carbs 56g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            }
        ]
    },
    'bundle-intermedio': {
        name: 'The Pantry Box (9 pcs)',
        price: 94,
        vipPrice: 74,
        img: '/immagini/box-intermedio.webp',
        desc: `The complete selection for Puglia lovers. Sweet jams, savory creams, and traditional preserves.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>1x Sun-dried Tomatoes in olive oil</li>
                   <li>1x Sea Asparagus (Salicornia)</li>
                   <li>1x Grilled Artichokes</li>
                   <li>1x Grilled Lampascioni</li>
                   <li>1x Bomba Pugliese (Spicy)</li>
                   <li>1x Black Olive Cream</li>
                   <li>1x Quince Jam</li>
                   <li>1x Prickly Pear Jam</li>
                   <li>1x Mandarin Marmalade</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Sun-dried Tomatoes', 
                text: `Sun-dried tomatoes flavored with typical Mediterranean spices for an even more intense taste. Excellent as an appetizer, side dish, for pasta and pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Sun-dried tomatoes 63%, olive oil 34%, salt, capers, garlic, chili pepper, mint, wine vinegar. Citric acid.<br>
                <strong>Values (100g):</strong> 169 Kcal | Fat 9.3g | Carbs 16g | Protein 3.5g | Salt 3.2g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/salicornia-in-olio-di-oliva.jpg', 
                title: 'Sea Asparagus (Salicornia)', 
                text: `A typical Mediterranean plant. Flavored with spices and enveloped in olive oil, it is an excellent accompaniment for salads, omelets, and seafood.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Salicornia 63%, olive oil 34%, garlic, chili pepper, mint, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.5g | Protein 2.4g | Salt 0.4g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Grilled Artichokes', 
                text: `Artichokes grilled on red-hot lava stones, flavored with natural local spices and preserved in olive oil. Excellent for appetizers and sandwiches.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian artichokes 63%, olive oil 34%, garlic, chili pepper, oregano, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.2g | Protein 1.8g | Salt 1.7g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Grilled Lampascioni', 
                text: `Wild onions grilled on red-hot lava stones and flavored with Mediterranean spices. A true, authentic Apulian specialty.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Lampascioni 63%, olive oil 34%, garlic, chili pepper, parsley, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 54 Kcal | Fat 3.7g | Carbs 4.0g | Protein 0.8g | Salt 1.5g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese', 
                text: `A bold, spicy spread born from the union of peppers, eggplants, red carrots, and chili peppers. Ideal for crostini, bruschetta, or pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Vegetables 60% (peppers, eggplants, red carrots, chili pepper), olive oil 37%, garlic, wine vinegar, salt. Citric acid.<br>
                <strong>Values (100g):</strong> 306 Kcal | Fat 32g | Carbs 3.7g | Protein 0.7g | Salt 2.3g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Black Olive Cream', 
                text: `A paté with the intense flavor of local black olives, expressing a typical Apulian taste. Ideal for salads, meat, pasta, and crostini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Black olives 89%, olive oil 9%. Acidity regulator: citric acid.<br>
                <strong>Values (100g):</strong> 189 Kcal | Fat 18g | Carbs 1.5g | Protein 0.8g | Salt 2.8g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/melacotogne.jpg', 
                title: 'Quince Jam', 
                text: `A jam produced by the manual processing of quince apples. Perfect for tarts and sponge cakes, but surprisingly great paired with meat and roasts.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Quinces 55%, sugar. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 235 Kcal | Fat 0g | Carbs 56g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/fichi-d-india.jpg', 
                title: 'Prickly Pear Jam', 
                text: `Enhances the authentic flavor of fresh seasonal fruit and immediately recalls the scents of Puglia. Suitable for breakfast toast or desserts.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Prickly pears 55%, sugar. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 234 Kcal | Fat 0g | Carbs 57g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Mandarin Marmalade', 
                text: `Preserves all the nutritional properties of seasonal mandarins; with an excellent balance between sweet and bitter, perfect to start the day.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian mandarins 55%, sugar, mandarin peel. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 227 Kcal | Fat 0g | Carbs 56g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            }
        ]
    },
    'bundle-completo': {
        name: 'The Grand Harvest (15 pcs)',
        price: 129,
        vipPrice: 99,
        img: '/immagini/box-completo.webp',
        desc: `The ultimate experience. The perfect pantry stock or a high-end corporate gift.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>2x Sun-dried Tomatoes in olive oil</li>
                   <li>1x Sea Asparagus (Salicornia)</li>
                   <li>2x Grilled Artichokes</li>
                   <li>1x Grilled Lampascioni</li>
                   <li>1x Grilled Borettane Onions</li>
                   <li>2x Bomba Pugliese (Spicy)</li>
                   <li>1x Lampascioni Cream</li>
                   <li>1x Black Olive Cream</li>
                   <li>1x Bitter Orange Marmalade</li>
                   <li>1x Quince Jam</li>
                   <li>1x Prickly Pear Jam</li>
                   <li>1x Mandarin Marmalade</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Sun-dried Tomatoes (x2)', 
                text: `Sun-dried tomatoes flavored with typical Mediterranean spices for an even more intense taste. Excellent as an appetizer, side dish, for pasta and pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Sun-dried tomatoes 63%, olive oil 34%, salt, capers, garlic, chili pepper, mint, wine vinegar. Citric acid.<br>
                <strong>Values (100g):</strong> 169 Kcal | Fat 9.3g | Carbs 16g | Protein 3.5g | Salt 3.2g<br>
                <strong>Unit Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/salicornia-in-olio-di-oliva.jpg', 
                title: 'Sea Asparagus (Salicornia)', 
                text: `A typical Mediterranean plant. Flavored with spices and enveloped in olive oil, it is an excellent accompaniment for salads, omelets, and seafood.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Salicornia 63%, olive oil 34%, garlic, chili pepper, mint, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.5g | Protein 2.4g | Salt 0.4g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Grilled Artichokes (x2)', 
                text: `Artichokes grilled on red-hot lava stones, flavored with natural local spices and preserved in olive oil. Excellent for appetizers and sandwiches.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian artichokes 63%, olive oil 34%, garlic, chili pepper, oregano, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.2g | Protein 1.8g | Salt 1.7g<br>
                <strong>Unit Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Grilled Lampascioni', 
                text: `Wild onions grilled on red-hot lava stones and flavored with Mediterranean spices. A true, authentic Apulian specialty.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Lampascioni 63%, olive oil 34%, garlic, chili pepper, parsley, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 54 Kcal | Fat 3.7g | Carbs 4.0g | Protein 0.8g | Salt 1.5g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/cipolle-borettane.jpg', 
                title: 'Grilled Borettane Onions', 
                text: `Borettane onions grilled on red-hot lava stones and flavored with Mediterranean spices. A real delight for the palate as an appetizer or side dish.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Borettane onions 63%, olive oil 34%, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 57 Kcal | Fat 3.8g | Carbs 2.2g | Protein 1.8g | Salt 2.2g<br>
                <strong>Weight:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese (x2)', 
                text: `A bold, spicy spread born from the union of peppers, eggplants, red carrots, and chili peppers. Ideal for crostini, bruschetta, or pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Vegetables 60% (peppers, eggplants, red carrots, chili pepper), olive oil 37%, garlic, wine vinegar, salt. Citric acid.<br>
                <strong>Values (100g):</strong> 306 Kcal | Fat 32g | Carbs 3.7g | Protein 0.7g | Salt 2.3g<br>
                <strong>Unit Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-lampascioni.jpg', 
                title: 'Lampascioni Cream', 
                text: `A thick, unique, and tasty cream suitable for various combinations. Excellent spread on fritters, crostini, bread, or to season main courses.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Lampascioni 53%, olive oil 44%, garlic, chili pepper, parsley, salt, wine vinegar. Citric acid, ascorbic acid.<br>
                <strong>Values (100g):</strong> 376 Kcal | Fat 40g | Carbs 3.7g | Protein 0.8g | Salt 1.3g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Black Olive Cream', 
                text: `A paté with the intense flavor of local black olives, expressing a typical Apulian taste. Ideal for salads, meat, pasta, and crostini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Black olives 89%, olive oil 9%. Acidity regulator: citric acid.<br>
                <strong>Values (100g):</strong> 189 Kcal | Fat 18g | Carbs 1.5g | Protein 0.8g | Salt 2.8g<br>
                <strong>Weight:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/confettura-extra-di-arance-amare.jpg', 
                title: 'Bitter Orange Marmalade', 
                text: `An intense flavor and the typical citrus aroma of bitter oranges. A bold choice for making desserts and gourmet pairings.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Bitter oranges 55%, sugar. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 226 Kcal | Fat 0g | Carbs 55g | Protein 0.6g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/melacotogne.jpg', 
                title: 'Quince Jam', 
                text: `A jam produced by the manual processing of quince apples. Perfect for tarts and sponge cakes, but surprisingly great paired with meat and roasts.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Quinces 55%, sugar. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 235 Kcal | Fat 0g | Carbs 56g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/fichi-d-india.jpg', 
                title: 'Prickly Pear Jam', 
                text: `Enhances the authentic flavor of fresh seasonal fruit and immediately recalls the scents of Puglia. Suitable for breakfast toast or desserts.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Prickly pears 55%, sugar. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 234 Kcal | Fat 0g | Carbs 57g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Mandarin Marmalade', 
                text: `Preserves all the nutritional properties of seasonal mandarins; with an excellent balance between sweet and bitter, perfect to start the day.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredients:</strong> Italian mandarins 55%, sugar, mandarin peel. Gelling agent: pectin. Citric acid. Fruit min. 55g/100g.<br>
                <strong>Values (100g):</strong> 227 Kcal | Fat 0g | Carbs 56g | Protein 0g | Salt 0.03g<br>
                <strong>Weight:</strong> 340g
                </div>` 
            }
        ]
    }
};

// --- DATI CATALOGO BOTTEGA (ITALIANO) ---
const CATALOG_IT = {
    'bundle-base': {
        name: 'La Box Degustazione (6 pz)',
        price: 69,
        vipPrice: 54,
        img: '/immagini/box-base.webp',
        desc: `Un assaggio autentico di Puglia. Un'introduzione accuratamente selezionata alla nostra dispensa tradizionale.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>1x Pomodori secchi in olio di oliva</li>
                   <li>1x Carciofi alla brace</li>
                   <li>1x Lampascioni alla brace</li>
                   <li>1x Bomba pugliese (Piccante)</li>
                   <li>1x Crema di olive nere</li>
                   <li>1x Marmellata di mandarini</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Pomodori Secchi', 
                text: `Pomodori secchi insaporiti da spezie tipiche del Mediterraneo per donare loro un gusto ancora più intenso. Ottimi come antipasto, contorno, per pasta e pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Pomodori secchi 63%, olio di oliva 34%, sale, capperi, aglio, peperoncino, menta, aceto di vino. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 169 Kcal | Grassi 9.3g | Carb 16g | Prot 3.5g | Sale 3.2g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Carciofi alla Brace', 
                text: `Carciofi grigliati su pietre laviche roventi, insaporiti da spezie naturali tipiche del nostro territorio e riposte in olio di oliva. Ottimi per antipasti, contorni e per farcire panini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Carciofi italiani 63%, olio di oliva 34%, aglio, peperoncino, origano, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.2g | Prot 1.8g | Sale 1.7g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Lampascioni alla Brace', 
                text: `Lampascioni grigliati su pietre laviche roventi ed insaporiti da spezie che ricordano il Mediterraneo, immersi in olio di oliva. Ideali come antipasto, contorno o per focacce.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Lampascioni 63%, olio di oliva 34%, aglio, peperoncino, prezzemolo, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 54 Kcal | Grassi 3.7g | Carb 4g | Prot 0.8g | Sale 1.5g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese', 
                text: `Unione di peperone, melanzana, carota rossa, peperoncino e altri vegetali della tradizione. Una salsa piccante ideale per crostini, pane, bruschette o pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Ortaggi in proporzione variabile 60% (peperoni, melanzane, carote rosse, peperoncino), olio di oliva 37%, aglio, aceto di vino, sale. Acido citrico.<br>
                <strong>Valori (100g):</strong> 306 Kcal | Grassi 32g | Carb 3.7g | Prot 0.7g | Sale 2.3g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Crema di Olive Nere', 
                text: `Un patè dal gusto intenso delle olive del nostro territorio, che esprime un sapore tipico pugliese. Ideale per insalate, carne, pasta, crostini e bruschette.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Olive nere 89%, olio di oliva 9%. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 189 Kcal | Grassi 18g | Carb 1.5g | Prot 0.8g | Sale 2.8g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Marmellata di Mandarini', 
                text: `Una marmellata che conserva tutte le proprietà nutritive dei mandarini di stagione; con un ottimo equilibrio tra dolce ed amaro, è perfetta a colazione per iniziare con energia.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Mandarini italiani 55%, zucchero, scorze di mandarini. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta utilizzata: min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 227 Kcal | Grassi 0g | Carb 56g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            }
        ]
    },
    'bundle-intermedio': {
        name: 'La Box Dispensa (9 pz)',
        price: 94,
        vipPrice: 74,
        img: '/immagini/box-intermedio.webp',
        desc: `La selezione completa per gli amanti della Puglia. Confetture dolci, creme salate e conserve della tradizione.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>1x Pomodori secchi in olio di oliva</li>
                   <li>1x Salicornia in olio di oliva</li>
                   <li>1x Carciofi alla brace</li>
                   <li>1x Lampascioni alla brace</li>
                   <li>1x Bomba pugliese (Piccante)</li>
                   <li>1x Crema di olive nere</li>
                   <li>1x Confettura di melacotogne</li>
                   <li>1x Confettura di fichi d'india</li>
                   <li>1x Marmellata di mandarini</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Pomodori Secchi', 
                text: `Pomodori secchi insaporiti da spezie tipiche del Mediterraneo per donare loro un gusto ancora più intenso. Ottimi come antipasto, contorno, per pasta e pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Pomodori secchi 63%, olio di oliva 34%, sale, capperi, aglio, peperoncino, menta, aceto di vino. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 169 Kcal | Grassi 9.3g | Carb 16g | Prot 3.5g | Sale 3.2g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/salicornia-in-olio-di-oliva.jpg', 
                title: 'Salicornia (Asparago di mare)', 
                text: `La salicornia o asparago di mare è una pianta tipica del Mediterraneo e delle zone pugliesi; insaporita da spezie e avvolta da olio di oliva è un ottimo accompagnamento per insalate, frittate e zuppe.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Salicornia 63%, olio di oliva 34%, aglio, peperoncino, menta, sale, aceto di vino. Acido citrico, acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.5g | Prot 2.4g | Sale 0.4g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Carciofi alla Brace', 
                text: `Carciofi grigliati su pietre laviche roventi, insaporiti da spezie naturali tipiche del nostro territorio e riposte in olio di oliva. Ottimi per antipasti, contorni e per farcire panini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Carciofi italiani 63%, olio di oliva 34%, aglio, peperoncino, origano, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.2g | Prot 1.8g | Sale 1.7g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Lampascioni alla Brace', 
                text: `Lampascioni grigliati su pietre laviche roventi ed insaporiti da spezie che ricordano il Mediterraneo, immersi in olio di oliva. Ideali come antipasto, contorno o per focacce.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Lampascioni 63%, olio di oliva 34%, aglio, peperoncino, prezzemolo, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 54 Kcal | Grassi 3.7g | Carb 4g | Prot 0.8g | Sale 1.5g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese', 
                text: `Unione di peperone, melanzana, carota rossa, peperoncino e altri vegetali della tradizione. Una salsa piccante ideale per crostini, pane, bruschette o pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Ortaggi in proporzione variabile 60% (peperoni, melanzane, carote rosse, peperoncino), olio di oliva 37%, aglio, aceto di vino, sale. Acido citrico.<br>
                <strong>Valori (100g):</strong> 306 Kcal | Grassi 32g | Carb 3.7g | Prot 0.7g | Sale 2.3g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Crema di Olive Nere', 
                text: `Un patè dal gusto intenso delle olive del nostro territorio, che esprime un sapore tipico pugliese. Ideale per insalate, carne, pasta, crostini e bruschette.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Olive nere 89%, olio di oliva 9%. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 189 Kcal | Grassi 18g | Carb 1.5g | Prot 0.8g | Sale 2.8g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/melacotogne.jpg', 
                title: 'Confettura di Melacotogne', 
                text: `Una confettura prodotta dalla lavorazione manuale di mele cotogne, perfetta per crostate e pan di spagna, ma anche in abbinamento con carne ed arrosto.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Mele cotogne 55%, zucchero. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta utilizzata: min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 235 Kcal | Grassi 0g | Carb 56g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/fichi-d-india.jpg', 
                title: 'Confettura di Fichi d\'India', 
                text: `Una confettura che esalta il sapore autentico della frutta fresca di stagione e rimanda immediatamente ai profumi della Puglia. Adatta a colazione o alla preparazione di dolci.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Fichi d'india 55%, zucchero. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 234 Kcal | Grassi 0g | Carb 57g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Marmellata di Mandarini', 
                text: `Una marmellata che conserva tutte le proprietà nutritive dei mandarini di stagione; con un ottimo equilibrio tra dolce ed amaro, è perfetta a colazione per iniziare con energia.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Mandarini italiani 55%, zucchero, scorze di mandarini. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta utilizzata: min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 227 Kcal | Grassi 0g | Carb 56g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            }
        ]
    },
    'bundle-completo': {
        name: 'Il Grande Raccolto (15 pz)',
        price: 129,
        vipPrice: 99,
        img: '/immagini/box-completo.webp',
        desc: `L'esperienza totale. La scorta perfetta per la dispensa o un regalo aziendale di altissimo livello.<br>
               <ul style="text-align:left; font-size:0.9rem; margin-top:15px; padding-left:20px; line-height:1.6; color:#555;">
                   <li>2x Pomodori secchi in olio di oliva</li>
                   <li>1x Salicornia in olio di oliva</li>
                   <li>2x Carciofi alla brace</li>
                   <li>1x Lampascioni alla brace</li>
                   <li>1x Cipolle borettane alla brace</li>
                   <li>2x Bomba pugliese (Piccante)</li>
                   <li>1x Crema di lampascioni</li>
                   <li>1x Crema di olive nere</li>
                   <li>1x Marmellata di arance amare</li>
                   <li>1x Confettura di melacotogne</li>
                   <li>1x Confettura di fichi d'india</li>
                   <li>1x Marmellata di mandarini</li>
               </ul>`,
        slides: [
            { 
                img: '/immagini/pomodori-secchi.jpg', 
                title: 'Pomodori Secchi (x2)', 
                text: `Pomodori secchi insaporiti da spezie tipiche del Mediterraneo per donare loro un gusto ancora più intenso. Ottimi come antipasto, contorno, per pasta e pizza.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Pomodori secchi 63%, olio di oliva 34%, sale, capperi, aglio, peperoncino, menta, aceto di vino. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 169 Kcal | Grassi 9.3g | Carb 16g | Prot 3.5g | Sale 3.2g<br>
                <strong>Peso unitario:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/salicornia-in-olio-di-oliva.jpg', 
                title: 'Salicornia (Asparago di mare)', 
                text: `La salicornia o asparago di mare è una pianta tipica del Mediterraneo e delle zone pugliesi; insaporita da spezie e avvolta da olio di oliva è un ottimo accompagnamento per insalate, frittate e zuppe.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Salicornia 63%, olio di oliva 34%, aglio, peperoncino, menta, sale, aceto di vino. Acido citrico, acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.5g | Prot 2.4g | Sale 0.4g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/carciofi-alla-brace.jpg', 
                title: 'Carciofi alla Brace (x2)', 
                text: `Carciofi grigliati su pietre laviche roventi, insaporiti da spezie naturali tipiche del nostro territorio e riposte in olio di oliva. Ottimi per antipasti, contorni e per farcire panini.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Carciofi italiani 63%, olio di oliva 34%, aglio, peperoncino, origano, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.2g | Prot 1.8g | Sale 1.7g<br>
                <strong>Peso unitario:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/lampascioni-alla-brace.jpg', 
                title: 'Lampascioni alla Brace', 
                text: `Lampascioni grigliati su pietre laviche roventi ed insaporiti da spezie che ricordano il Mediterraneo, immersi in olio di oliva. Ideali come antipasto, contorno o per focacce.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Lampascioni 63%, olio di oliva 34%, aglio, peperoncino, prezzemolo, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 54 Kcal | Grassi 3.7g | Carb 4g | Prot 0.8g | Sale 1.5g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/cipolle-borettane.jpg', 
                title: 'Cipolle Borettane alla Brace', 
                text: `Cipolle grigliate su pietre laviche roventi ed insaporite da spezie mediterranee secondo la tradizione pugliese sono una vera delizia per il palato come antipasto o contorno.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Cipolle Borrettane 63%, olio di oliva 34%, sale, aceto di vino. Correttore di acidità: acido citrico. Antiossidante: acido ascorbico.<br>
                <strong>Valori (100g):</strong> 57 Kcal | Grassi 3.8g | Carb 2.2g | Prot 1.8g | Sale 2.2g<br>
                <strong>Peso:</strong> 280g
                </div>` 
            },
            { 
                img: '/immagini/bomba-pugliese.jpg', 
                title: 'Bomba Pugliese (x2)', 
                text: `Unione di peperone, melanzana, carota rossa, peperoncino e altri vegetali della tradizione. Una salsa piccante ideale per crostini, pane, bruschette o pasta.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Ortaggi in proporzione variabile 60% (peperoni, melanzane, carote rosse, peperoncino), olio di oliva 37%, aglio, aceto di vino, sale. Acido citrico.<br>
                <strong>Valori (100g):</strong> 306 Kcal | Grassi 32g | Carb 3.7g | Prot 0.7g | Sale 2.3g<br>
                <strong>Peso unitario:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-lampascioni.jpg', 
                title: 'Crema di Lampascioni', 
                text: `Il patè di lampascioni, una crema densa, unica e gustosa che si presta a diversi accostamenti. Ottima da spalmare su frittelle, crostini e bruschette.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Lampascioni 53%, olio di oliva 44%, aglio, peperoncino, prezzemolo, sale, aceto di vino. Acido citrico, acido ascorbico.<br>
                <strong>Valori (100g):</strong> 376 Kcal | Grassi 40g | Carb 3.7g | Prot 0.8g | Sale 1.3g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/crema-di-olive-nere.jpg', 
                title: 'Crema di Olive Nere', 
                text: `Un patè dal gusto intenso delle olive del nostro territorio, che esprime un sapore tipico pugliese. Ideale per insalate, carne, pasta, crostini e bruschette.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Olive nere 89%, olio di oliva 9%. Correttore di acidità: acido citrico.<br>
                <strong>Valori (100g):</strong> 189 Kcal | Grassi 18g | Carb 1.5g | Prot 0.8g | Sale 2.8g<br>
                <strong>Peso:</strong> 190g
                </div>` 
            },
            { 
                img: '/immagini/confettura-extra-di-arance-amare.jpg', 
                title: 'Marmellata di Arance Amare', 
                text: `Una marmellata dal gusto intenso e dall’aroma agrumato tipico delle arance amare. Una scelta audace per la preparazione di dolci e abbinamenti gourmet.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Arance amare 55%, zucchero. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 226 Kcal | Grassi 0g | Carb 55g | Prot 0.6g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/melacotogne.jpg', 
                title: 'Confettura di Melacotogne', 
                text: `Una confettura prodotta dalla lavorazione manuale di mele cotogne, perfetta per crostate e pan di spagna, ma anche in abbinamento con carne ed arrosto.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Mele cotogne 55%, zucchero. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta utilizzata: min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 235 Kcal | Grassi 0g | Carb 56g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/fichi-d-india.jpg', 
                title: 'Confettura di Fichi d\'India', 
                text: `Una confettura che esalta il sapore autentico della frutta fresca di stagione e rimanda immediatamente ai profumi della Puglia. Adatta a colazione o alla preparazione di dolci.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Fichi d'india 55%, zucchero. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 234 Kcal | Grassi 0g | Carb 57g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            },
            { 
                img: '/immagini/marmellata-di-mandarini.jpg', 
                title: 'Marmellata di Mandarini', 
                text: `Una marmellata che conserva tutte le proprietà nutritive dei mandarini di stagione; con un ottimo equilibrio tra dolce ed amaro, è perfetta a colazione per iniziare con energia.
                <div style="font-size:0.75rem; text-align:left; background:#f9f9f9; padding:12px; border-radius:8px; margin-top:15px; line-height:1.4;">
                <strong>Ingredienti:</strong> Mandarini italiani 55%, zucchero, scorze di mandarini. Gelificante: pectina. Correttore di acidità: acido citrico. Frutta utilizzata: min. 55g per 100g.<br>
                <strong>Valori (100g):</strong> 227 Kcal | Grassi 0g | Carb 56g | Prot 0g | Sale 0.03g<br>
                <strong>Peso:</strong> 340g
                </div>` 
            }
        ]
    }
};

// --- SCELTA AUTOMATICA DELLA LINGUA ---
const BOTTEGA_CATALOG = (window.currentLang === 'it') ? CATALOG_IT : CATALOG_EN;

// --- GESTIONE MODALE CAROSELLO ---
const productModal = document.getElementById('product-detail-modal');
const slidesContainer = document.getElementById('product-slides-container');
let currentActiveProduct = '';

window.openProductModal = (bundleId) => {
    const product = BOTTEGA_CATALOG[bundleId];
    if (!product) return;
    currentActiveProduct = bundleId;
    
    slidesContainer.innerHTML = '';
    
    const isVip = !!localStorage.getItem('ayo_vip_id');
    const displayPrice = isVip ? product.vipPrice : product.price;
    
    // Testi dinamici in base alla lingua
    const txtShipping = window.currentLang === 'it' ? 'Spedizione EU Inclusa' : 'EU Shipping Inc.';
    const txtAddCart = window.currentLang === 'it' ? 'Aggiungi al Carrello' : 'Add to Cart';

    // SLIDE 1 (Un solo bottone, niente scritta swipe)
    slidesContainer.innerHTML += `
        <li class="slide">
            <div class="product-slide-content">
                <img src="${product.img}" alt="${product.name}" class="product-slide-img">
                <h2>${product.name}</h2>
                <p class="product-desc">${product.desc}</p>
                <div style="font-size:1.8rem; color:#2c5e2e; font-weight:bold; margin-bottom: 20px;">
                    €${displayPrice} <span style="font-size:0.8rem; color:#999; font-weight:normal;">${txtShipping}</span>
                </div>
                
                <button class="btn-primary" style="width:100%; max-width:300px;" onclick="addToCart('${bundleId}')">${txtAddCart}</button>
            </div>
        </li>
    `;

    // SLIDE SUCCESSIVE
    if (product.slides && product.slides.length > 0) {
        product.slides.forEach(item => {
            slidesContainer.innerHTML += `
                <li class="slide">
                    <div class="product-slide-content">
                        <img src="${item.img}" alt="${item.title}" class="product-slide-img">
                        <h3>${item.title}</h3>
                        <p class="product-desc">${item.text}</p>
                    </div>
                </li>
            `;
        });
    }

    // 1. Mostra PRIMA la modale (così il browser ne calcola le dimensioni)
    productModal.showModal();

    // 2. POI forza lo scorrimento alla Slide 1
    const scrollContainer = document.getElementById('modal-slider-container');
    if (scrollContainer) {
        scrollContainer.scrollLeft = 0;
    }
};

window.closeProductModal = () => {
    if (productModal) productModal.close();
};

// FIX: GESTIONE SCORRIMENTO FRECCE NELLA MODALE (INFINITO)
const modalPrevBtn = document.querySelector('#product-slider .prev-btn');
const modalNextBtn = document.querySelector('#product-slider .next-btn');
const modalSliderContainer = document.getElementById('modal-slider-container');

if (modalPrevBtn && modalNextBtn && modalSliderContainer) {
    
    modalNextBtn.addEventListener('click', () => {
        const slideWidth = modalSliderContainer.offsetWidth;
        const maxScrollLeft = modalSliderContainer.scrollWidth - slideWidth;
        
        // Se siamo vicini alla fine, torna all'inizio (0)
        if (modalSliderContainer.scrollLeft >= maxScrollLeft - 10) {
            modalSliderContainer.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
            modalSliderContainer.scrollBy({ left: slideWidth, behavior: 'smooth' });
        }
    });

    modalPrevBtn.addEventListener('click', () => {
        const slideWidth = modalSliderContainer.offsetWidth;
        
        // Se siamo all'inizio, vai alla fine (maxScrollLeft)
        if (modalSliderContainer.scrollLeft <= 0) {
            modalSliderContainer.scrollTo({ left: modalSliderContainer.scrollWidth, behavior: 'smooth' });
        } else {
            modalSliderContainer.scrollBy({ left: -slideWidth, behavior: 'smooth' });
        }
    });
}

// --- GESTIONE CARRELLO LATERALE ---
let bottegaCart = JSON.parse(localStorage.getItem('ayo_bottega_cart')) || [];
const slideoutCart = document.getElementById('slideout-cart');
const cartOverlay = document.getElementById('cart-overlay');
const cartItemsContainer = document.getElementById('cart-items-container');
const cartTotalPrice = document.getElementById('cart-total-price');

window.openCart = () => {
    slideoutCart.classList.add('open');
    cartOverlay.classList.add('show');
    updateCartUI();
};

window.closeCart = () => {
    slideoutCart.classList.remove('open');
    cartOverlay.classList.remove('show');
};

window.addToCart = (bundleId, qty = 1) => {
    const existing = bottegaCart.find(item => item.id === bundleId);
    if (existing) {
        existing.qty += qty;
    } else {
        // FIX CRUCIALE: usiamo .push() per aggiungere, invece di = per sovrascrivere
        bottegaCart.push({ id: bundleId, qty: qty }); 
    }
    closeProductModal();
    openCart();
};

window.updateQty = (bundleId, delta) => {
    const item = bottegaCart.find(i => i.id === bundleId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        bottegaCart = bottegaCart.filter(i => i.id !== bundleId);
    }
    updateCartUI();
};

window.updateCartUI = () => {
    const isVip = !!localStorage.getItem('ayo_vip_id');
    let total = 0;
    let itemCount = 0; // Contatore totale pezzi
    cartItemsContainer.innerHTML = '';

    const txtEmpty = window.currentLang === 'it' ? 'Il tuo carrello è vuoto.' : 'Your cart is empty.';
    const txtRemove = window.currentLang === 'it' ? 'Rimuovi' : 'Remove';

    if (bottegaCart.length === 0) {
        cartItemsContainer.innerHTML = `<p style="text-align:center; color:#999; margin-top:40px;">${txtEmpty}</p>`;
    } else {
        bottegaCart.forEach(item => {
            const product = CATALOG_EN[item.id] || CATALOG_IT[item.id]; // Cerca in entrambi per sicurezza
            const price = isVip ? product.vipPrice : product.price;
            total += price * item.qty;
            itemCount += item.qty;

            cartItemsContainer.innerHTML += `
                <div class="cart-item">
                    <img src="${product.img}" alt="${product.name}" class="cart-item-img">
                    <div class="cart-item-details">
                        <div class="cart-item-title">${product.name}</div>
                        <div class="cart-item-price">€${price.toFixed(2)}</div>
                        <div class="qty-controls">
                            <button class="qty-btn" onclick="updateQty('${item.id}', -1)">-</button>
                            <span>${item.qty}</span>
                            <button class="qty-btn" onclick="updateQty('${item.id}', 1)">+</button>
                            <button class="remove-btn" onclick="updateQty('${item.id}', -${item.qty})">${txtRemove}</button>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    // Aggiorna Badge Navbar
    const badge = document.getElementById('cart-badge');
    if (badge) {
        if (itemCount > 0) {
            badge.textContent = itemCount;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    cartTotalPrice.textContent = `€${total.toFixed(2)}`;
    document.getElementById('checkout-btn').disabled = bottegaCart.length === 0;
    localStorage.setItem('ayo_bottega_cart', JSON.stringify(bottegaCart));
};

if (bottegaCart.length > 0 && document.getElementById('slideout-cart')) {
    updateCartUI();
}

document.getElementById('cart-is-gift')?.addEventListener('change', (e) => {
    document.getElementById('cart-gift-message').style.display = e.target.checked ? 'block' : 'none';
});

indow.proceedToCheckout = async () => {
    if (bottegaCart.length === 0) return;

    const checkoutBtn = document.getElementById('checkout-btn');
    const originalText = checkoutBtn.textContent;
    checkoutBtn.textContent = window.currentLang === 'it' ? 'Reindirizzamento a Stripe...' : 'Redirecting to Stripe...';
    checkoutBtn.disabled = true;

    const isGift = document.getElementById('cart-is-gift').checked;
    const giftMessage = document.getElementById('cart-gift-message').value;
    const memberId = localStorage.getItem('ayo_vip_id') || '';

    // FIX CRUCIALE: Inviamo TUTTO l'array del carrello, non solo il primo item
    const payload = {
        cart: bottegaCart, // <-- Questo ora è un array con tutti i prodotti e le quantità
        isGift: isGift,
        giftMessage: giftMessage,
        memberId: memberId,
        lang: window.currentLang || 'en',
        buyerFirstName: '',
        buyerLastName: '',
        email: ''
    };

    try {
        const response = await fetch('/.netlify/functions/checkout', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();
        if (response.ok) {
            window.location.href = result.url;
        } else {
            throw new Error(result.error || 'Checkout Error');
        }
    } catch (error) {
        console.error(error);
        const txtError = window.currentLang === 'it' ? 'Errore durante il checkout: ' : 'Error during checkout: ';
        alert(txtError + error.message);
        checkoutBtn.textContent = originalText;
        checkoutBtn.disabled = false;
    }
};

// Riapre il carrello se l'utente ha annullato il pagamento da Stripe
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.search.includes('payment=cancelled') && document.getElementById('slideout-cart')) {
        window.history.replaceState({}, document.title, window.location.pathname);
        openCart();
    }
});

// Ripristina i bottoni bloccati se l'utente usa la freccia "Indietro" del browser
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        // Ripristina modale Adozioni
        const adoptBtn = document.querySelector('#adoption-form button[type="submit"]');
        if (adoptBtn) {
            adoptBtn.textContent = window.currentLang === 'it' ? 'Procedi al Pagamento Sicuro →' : 'Proceed to Secure Payment →';
            adoptBtn.disabled = false;
        }
        
        // Ripristina bottone carrello Bottega
        const checkoutBtn = document.getElementById('checkout-btn');
        if (checkoutBtn) {
            checkoutBtn.textContent = window.currentLang === 'it' ? 'Procedi al Pagamento Sicuro' : 'Proceed to Secure Payment';
            checkoutBtn.disabled = false;
        }
    }
});
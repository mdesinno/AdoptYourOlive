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
    const urlParams = new URLSearchParams(window.location.search);
    const discountFromUrl = urlParams.get('discount'); 
    // Es: ?discount=SUMMER25

    const discountInput = document.getElementById('discount-code');
    const discountMsg = document.getElementById('discount-message');

    if (discountFromUrl && discountInput) {
        const cleanCode = discountFromUrl.toUpperCase().trim();
        discountInput.value = cleanCode;
        
        // Feedback Visivo
        discountInput.style.borderColor = 'var(--primary-green)';
        discountInput.style.backgroundColor = '#f0f9eb'; // verdino chiaro
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
    // Cerchiamo l'elemento con classe 'toggle-header' (assicurati di averla messa nell'HTML)
    const faqMainHeader = document.querySelector('.toggle-header');
    
    if (faqMainHeader) {
        faqMainHeader.addEventListener('click', function() {
            // Ruota la freccia del titolo
            this.classList.toggle('active');
            
            // Trova il wrapper nascosto subito sotto
            const wrapper = this.nextElementSibling;
            if (wrapper) {
                wrapper.classList.toggle('open');
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

        // 1. GESTIONE ANALYTICS (Google Analytics 4)
        // Parte se l'utente accetta "Analytics" o "Tutto"
        if (consentData.analytics) {
            if (!document.getElementById('ga4-script')) {
                console.log("Loading Google Analytics...");
                
                const gaScript = document.createElement('script');
                gaScript.id = 'ga4-script';
                gaScript.src = "https://www.googletagmanager.com/gtag/js?id=G-FE1BSWKNP8"; // TUO CODICE GOOGLE
                gaScript.async = true;
                document.head.appendChild(gaScript);

                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', 'G-FE1BSWKNP8', { 'anonymize_ip': true });
            }
        }

        // 2. GESTIONE MARKETING (Facebook & TikTok)
        if (consentData.marketing) {
            console.log("Loading Marketing Pixels...");

            // --- A. META PIXEL (Facebook/Instagram) ---
            const META_PIXEL_ID = '1636864481057719'; 

            if (META_PIXEL_ID !== '1636864481057719' && !document.getElementById('fb-pixel')) {
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
                  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t.split(".").forEach(function(e){t=ttq,e.split(".").forEach(function(e){t=t[e]},t)}),t.push([e].concat(Array.prototype.slice.call(arguments,0)))},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
                  
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
        }
    }

    // --- CONTROLLO INIZIALE ---
    const savedConsent = localStorage.getItem(consentKey);

    if (!savedConsent) {
        if (cookieBanner) setTimeout(() => { cookieBanner.style.display = 'flex'; }, 1000);
    } else {
        const consentData = JSON.parse(savedConsent);
        loadScriptsBasedOnConsent(consentData);
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
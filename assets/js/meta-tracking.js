/**
 * Blissful Senja — unified tracking wrapper.
 * Fires each event to (a) Meta Pixel, (b) Meta CAPI (server-side),
 * (c) Google Analytics 4 via gtag. Meta events share event_id for dedupe.
 *
 * Configure GA4_ID below with your Measurement ID (G-XXXXXXXXXX).
 */
(function () {
  'use strict';

  // ---------- CONFIG ---------------------------------------------------------
  var GA4_ID        = 'G-23Z5LJB3VP';       // <-- YOUR GA4 MEASUREMENT ID HERE
  var CAPI_ENDPOINT = '/api/meta-capi.php';
  var IDENTITY_KEY  = 'bs_identity';
  var EXTID_KEY     = 'bs_extid';
  var EXTID_COOKIE  = 'bs_extid';
  var GCLID_COOKIE  = 'bs_gclid';
  // Appends a short click reference to WhatsApp messages so bookings that close
  // in chat can be matched back to the ad click. Set to false to turn off.
  var WA_APPEND_REF = true;

  // ---------- LOAD gtag.js DYNAMICALLY ---------------------------------------
  if (GA4_ID && GA4_ID.indexOf('G-') === 0 && GA4_ID !== 'G-REPLACE_ME') {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    // NOTE: send_page_view=false because we fire our own page_view for consistent event_id
    gtag('config', GA4_ID, { send_page_view: false });
  }

  // ---------- UTIL -----------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function getCookie(name) {
    var m = document.cookie.match('(?:^|;)\\s*' + name + '=([^;]+)');
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days * 86400000));
    document.cookie = name + '=' + encodeURIComponent(value) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function safeGetLS(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function safeSetLS(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  function getFbc() {
    var fbc = getCookie('_fbc');
    if (fbc) return fbc;
    var m = location.search.match(/[?&]fbclid=([^&]+)/);
    if (m) {
      var built = 'fb.1.' + Date.now() + '.' + m[1];
      setCookie('_fbc', built, 90);
      return built;
    }
    return '';
  }
  // ---------- GOOGLE ADS: gclid capture --------------------------------------
  // Google's own Conversion Linker handles gclid for on-site conversions.
  // We store it ourselves as well so it can ride along into WhatsApp chats and
  // the booking form, which is what makes offline conversion import possible.
  function getGclid() {
    var stored = getCookie(GCLID_COOKIE);
    var m = location.search.match(/[?&]gclid=([^&]+)/);
    if (m) { setCookie(GCLID_COOKIE, m[1], 90); return m[1]; }
    return stored || '';
  }
  function getGclidRef() {
    var g = getGclid();
    return g ? g.slice(-8) : '';
  }

  // ---------- GTM dataLayer --------------------------------------------------
  function dlPush(obj) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(obj);
    } catch (e) {}
  }

  // Pull the treatment name out of a wa.me pre-filled message.
  function treatmentFromWaHref(href) {
    try {
      var t = new URL(href, location.href).searchParams.get('text') || '';
      var m = t.match(/book (?:a|an) ([^.]+)/i) || t.match(/inquire about (?:a|an) ([^.]+)/i);
      return m ? m[1].trim() : 'General enquiry';
    } catch (e) { return 'unknown'; }
  }

  function getExternalId() {
    var id = safeGetLS(EXTID_KEY) || getCookie(EXTID_COOKIE);
    if (!id) { id = uuid(); safeSetLS(EXTID_KEY, id); }
    setCookie(EXTID_COOKIE, id, 730);
    return id;
  }
  function getIdentity() {
    var raw = safeGetLS(IDENTITY_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  function saveIdentity(payload) {
    var existing = getIdentity();
    var merged = {
      email:   payload.email   || existing.email   || '',
      phone:   payload.phone   || existing.phone   || '',
      fn:      payload.fn      || existing.fn      || '',
      ln:      payload.ln      || existing.ln      || '',
      country: payload.country || existing.country || ''
    };
    safeSetLS(IDENTITY_KEY, JSON.stringify(merged));
    return merged;
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Map Meta event names to GA4 conventions
  function ga4EventName(metaEvent) {
    switch (metaEvent) {
      case 'PageView': return 'page_view';
      case 'Contact':  return 'contact';
      case 'Lead':     return 'generate_lead';
      case 'ViewContent': return 'view_item';
      case 'Purchase': return 'purchase';
      default: return metaEvent.toLowerCase();
    }
  }

  // ---------- CORE FIRE ------------------------------------------------------
  function fireEvent(eventName, opts) {
    opts = opts || {};
    var eventId = opts.event_id || uuid();
    var custom  = opts.custom_data || {};
    var user    = opts.user_data   || {};

    var externalId = getExternalId();
    var identity   = getIdentity();

    var mergedUser = {
      email:   user.email   || identity.email   || '',
      phone:   user.phone   || identity.phone   || '',
      fn:      user.fn      || identity.fn      || '',
      ln:      user.ln      || identity.ln      || '',
      country: user.country || identity.country || 'ID'
    };

    // 1) Meta Pixel (browser)
    if (window.fbq) {
      try { window.fbq('track', eventName, custom, { eventID: eventId }); } catch (e) {}
    }

    // 2) Meta CAPI (server)
    try {
      var body = {
        event_name:       eventName,
        event_id:         eventId,
        event_time:       Math.floor(Date.now() / 1000),
        event_source_url: location.href,
        fbp:              getCookie('_fbp'),
        fbc:              getFbc(),
        external_id:      externalId,
        country:          mergedUser.country,
        custom_data:      custom
      };
      if (mergedUser.email) body.email = mergedUser.email;
      if (mergedUser.phone) body.phone = mergedUser.phone;
      if (mergedUser.fn)    body.fn    = mergedUser.fn;
      if (mergedUser.ln)    body.ln    = mergedUser.ln;
      var json = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(CAPI_ENDPOINT, new Blob([json], { type: 'application/json' }));
      } else {
        fetch(CAPI_ENDPOINT, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:json, keepalive:true, credentials:'omit'
        }).catch(function(){});
      }
    } catch (e) {}

    // 3) GA4 (browser via gtag)
    if (window.gtag) {
      try {
        var ga4Payload = {};
        // Copy custom_data into GA4 params
        for (var k in custom) if (custom.hasOwnProperty(k)) ga4Payload[k] = custom[k];
        // Standard GA4 fields
        if (custom.currency) ga4Payload.currency = custom.currency;
        if (custom.value)    ga4Payload.value    = custom.value;
        ga4Payload.event_id = eventId;  // GA4 uses this for dedupe in Google Ads too
        window.gtag('event', ga4EventName(eventName), ga4Payload);
      } catch (e) {}
    }

    return eventId;
  }

  // ---------- PUBLIC API -----------------------------------------------------
  window.MetaTrack = {
    fire:    fireEvent,
    pageView: function () { return fireEvent('PageView'); },
    contact: function (source) {
      return fireEvent('Contact', {
        custom_data: { content_name: 'WhatsApp Click', source: source || 'unknown' }
      });
    },
    lead: function (payload) {
      payload = payload || {};
      dlPush({
        event:      'booking_form_success',
        treatment:  payload.service || 'unspecified',
        value:      payload.value || 160000,
        currency:   'IDR',
        gclid:      getGclid()
      });
      var saved = saveIdentity({
        email:   payload.email,
        phone:   payload.phone,
        fn:      payload.fn,
        country: 'ID'
      });
      return fireEvent('Lead', {
        user_data: {
          email:   saved.email,
          phone:   saved.phone,
          fn:      saved.fn,
          country: 'ID'
        },
        custom_data: {
          content_name:     'Booking Request',
          content_category: payload.service || '',
          currency:         'IDR',
          value:            payload.value || 0
        }
      });
    }
  };

  // ---------- AUTO EVENTS ----------------------------------------------------
  ready(function () {
    getExternalId();
    getGclid();
    window.MetaTrack.pageView();

    // Tag WhatsApp links with the ad click reference so chat bookings are traceable.
    if (WA_APPEND_REF) {
      var ref = getGclidRef();
      if (ref) {
        document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"]')
          .forEach(function (a) {
            if (a.href.indexOf('%5Bref%3A') !== -1 || a.href.indexOf('[ref:') !== -1) return;
            a.href += encodeURIComponent('\n\n[ref: ' + ref + ']');
          });
      }
    }

    // Carry the gclid into the booking form so confirmed bookings can be
    // uploaded back to Google Ads as offline conversions.
    document.querySelectorAll('form[data-dc-submit]').forEach(function (f) {
      if (f.querySelector('input[name="gclid"]')) return;
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = 'gclid'; i.value = getGclid();
      f.appendChild(i);
    });

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
      if (!a) return;
      var source =
        a.className && a.className.indexOf('blog-cta') !== -1 ?
          ('blog_' + (a.getAttribute('data-cta-loc') || 'cta')) :
        a.className && a.className.indexOf('nav-wa') !== -1  ? 'nav'         :
        a.className && a.className.indexOf('btn-wa-hero') !== -1 ? 'hero'    :
        a.className && a.className.indexOf('booking-wa') !== -1 ? 'booking'  :
        a.closest('footer') ? 'footer' : 'inline';
      window.MetaTrack.contact(source);
      dlPush({
        event:           'whatsapp_click',
        treatment:       treatmentFromWaHref(a.getAttribute('href')),
        button_location: source,
        gclid:           getGclid()
      });
    }, true);
  });
})();

document.addEventListener("DOMContentLoaded", function () {
    "use strict";

    const WHATSAPP = "5516994205525";
    const IFOOD = "https://www.ifood.com.br/delivery/sertaozinho-sp/puro-amor---delicias-caseiras-conjunto-habitacional-maurilio-biagi/fb01a186-3e54-42f7-aec3-e7140c6ced1c?utm_medium=share";
    const LOJA_ENDERECO = "Rua Luís Schiavinato, 164 - CEP 14177-308, Sertãozinho - SP, Brasil";
    let deliveryFee = 0;
    const CART_KEY = "puroAmorCarrinho";
    const ORDER_KEY = "puroAmorUltimoPedido";
    const ORDER_HISTORY_KEY = "puroAmorHistoricoPedidos";
    const ORDER_NUMBER_KEY = "puroAmorNumeroPedido";
    const FAV_KEY = "puroAmorFavoritos";
    const AVAIL_KEY = "puroAmorDisponibilidade";
    const PRODUCT_KEY = "puroAmorProdutos";
    const CUSTOM_PRODUCTS_KEY = "puroAmorProdutosNovos";
    const REMOVED_PRODUCTS_KEY = "puroAmorProdutosRemovidos";
    const COUPON_KEY = "puroAmorCuponsAutorizados";
    const CATEGORY_KEY = "puroAmorCategorias";
    const FEATURED_KEY = "puroAmorDestaques";
    // Altere este PIN para outro de sua preferência.
    // Observação: como o site é estático, isto não é uma proteção de segurança real.
    const ADMIN_PIN = "1234";
    const AUTHORIZED_ADMIN_EMAILS = new Set([
        "lf5680878@gmail.com",
        "projetositepuroamor@gmail.com",
        "ls9114554@gmail.com"
    ]);

    /* =====================================================
       SUPABASE - PERSISTÊNCIA ONLINE
       A Publishable Key pode ficar no navegador.
       Nunca coloque aqui a Secret Key ou a senha do banco.
    ===================================================== */
    const SUPABASE_URL = "https://uhwnfxfawrkdacylbjqs.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tfa3IEVhYlftTiR3sHsnFg_vHdoUFaf";
    const SUPABASE_TABLE = "Produtos";
    const supabaseClient = window.supabase?.createClient
        ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
        : null;
    let supabaseOnline = false;

    const $ = (s, root = document) => root.querySelector(s);
    const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

    let cart = loadJSON(CART_KEY, []);
    let favorites = loadJSON(FAV_KEY, []);
    let favoriteOnly = false;
    let coupon = null;
    let availability = loadJSON(AVAIL_KEY, {});
    let productData = loadJSON(PRODUCT_KEY, {});
    let customProducts = loadJSON(CUSTOM_PRODUCTS_KEY, []);
    let removedProducts = loadJSON(REMOVED_PRODUCTS_KEY, []);
    let coupons = loadJSON(COUPON_KEY, null);
    let categories = loadJSON(CATEGORY_KEY, ["fatias", "gelados", "bombons"]);
    let featured = loadJSON(FEATURED_KEY, {});
    if (!featured || typeof featured !== "object" || Array.isArray(featured)) featured = {};
    let orderHistory = loadJSON(ORDER_HISTORY_KEY, []);
    if (!Array.isArray(orderHistory)) orderHistory = [];
    if (!Array.isArray(categories)) categories = ["fatias", "gelados", "bombons"];
    categories = Array.from(new Set(categories.map(v => String(v || "").trim()).filter(Boolean)));
    saveJSON(CATEGORY_KEY, categories);
    if (!Array.isArray(coupons)) {
        coupons = [
            { code: "PURO10", type: "percent", value: 10, active: true },
            { code: "AMOR5", type: "percent", value: 5, active: true }
        ];
        saveJSON(COUPON_KEY, coupons);
    }

    function loadJSON(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value == null ? fallback : value;
        } catch (_) { return fallback; }
    }

    function saveJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }

    function remoteProductPayload(name) {
        const data = getProduct(name);
        const flavors = normalizeFlavors(data.flavors);
        const available = availability[name] !== false && !(data.stock !== null && data.stock !== undefined && data.stock !== "" && Number(data.stock) <= 0);
        const flags = getFeatured(name);
        return {
            name: String(name),
            price: Number(data.price || 0),
            stock: data.stock === null || data.stock === undefined || data.stock === "" ? null : Math.max(0, Number(data.stock)),
            category: String(data.category || "Outros"),
            weight: String(data.weight || ""),
            description: String(data.description || ""),
            image: String(data.image || ""),
            flavors: flavors.join(", "),
            available: !!available,
            novidade: !!flags.novidade,
            mais_pedidos: !!flags.maisPedidos
        };
    }

    async function saveProductOnline(name) {
        if (!supabaseClient || !name) return false;
        try {
            const payload = remoteProductPayload(name);
            const { data: existing, error: findError } = await supabaseClient
                .from(SUPABASE_TABLE).select("id").eq("name", name).limit(1);
            if (findError) throw findError;
            if (existing && existing.length) {
                const { error } = await supabaseClient.from(SUPABASE_TABLE)
                    .update(payload).eq("id", existing[0].id);
                if (error) throw error;
            } else {
                const { error } = await supabaseClient.from(SUPABASE_TABLE).insert(payload);
                if (error) throw error;
            }
            supabaseOnline = true;
            return true;
        } catch (error) {
            console.error("Supabase: não foi possível salvar o produto.", error);
            supabaseOnline = false;
            toast("Não foi possível sincronizar este produto online.");
            return false;
        }
    }

    async function removeProductOnline(name) {
        if (!supabaseClient || !name) return false;
        try {
            const { error } = await supabaseClient.from(SUPABASE_TABLE)
                .update({ available: false }).eq("name", name);
            if (error) throw error;
            supabaseOnline = true;
            return true;
        } catch (error) {
            console.error("Supabase: não foi possível marcar o produto como removido.", error);
            supabaseOnline = false;
            toast("O produto foi removido deste navegador, mas não foi sincronizado online.");
            return false;
        }
    }

    async function loadProductsOnline() {
        if (!supabaseClient) {
            console.warn("Supabase JS não carregado; usando armazenamento local.");
            return;
        }
        try {
            const { data: rows, error } = await supabaseClient.from(SUPABASE_TABLE)
                .select("id,name,price,stock,category,weight,description,image,flavors,available,novidade,mais_pedidos")
                .order("id", { ascending: true });
            if (error) throw error;
            const staticNames = new Set(productCards().map(card =>
                normalize($(".order-btn", card)?.dataset.product || "")
            ));
            (rows || []).forEach(row => {
                if (!row.name) return;
                const name = String(row.name);
                const key = normalize(name);
                const remoteData = {
                    price: Number(row.price || 0),
                    stock: row.stock === null ? null : Number(row.stock),
                    category: row.category || "Outros",
                    weight: row.weight || "",
                    description: row.description || "",
                    image: row.image || "",
                    flavors: normalizeFlavors(row.flavors || ""),
                    novidade: row.novidade === true,
                    maisPedidos: row.mais_pedidos === true
                };
                productData[name] = { ...(productData[name] || {}), ...remoteData };
                availability[name] = row.available !== false;
                featured[name] = { novidade: row.novidade === true, maisPedidos: row.mais_pedidos === true };
                if (!staticNames.has(key)) {
                    const localCustom = customProducts.find(p => normalize(p.name) === key);
                    if (localCustom) {
                        Object.assign(localCustom, {
                            remoteId: row.id, price: remoteData.price, stock: remoteData.stock,
                            category: remoteData.category, weight: remoteData.weight,
                            flavors: remoteData.flavors, description: remoteData.description,
                            image: remoteData.image, remoteAvailable: row.available !== false
                        });
                    } else {
                        customProducts.push({
                            id: "remote-" + row.id, remoteId: row.id, name,
                            price: remoteData.price, stock: remoteData.stock,
                            category: remoteData.category, weight: remoteData.weight,
                            flavors: remoteData.flavors, description: remoteData.description,
                            image: remoteData.image, remoteAvailable: row.available !== false,
                            createdAt: new Date().toISOString()
                        });
                    }
                }
            });
            saveJSON(PRODUCT_KEY, productData);
            saveJSON(AVAIL_KEY, availability);
            saveJSON(FEATURED_KEY, featured);
            saveCustomProducts();
            supabaseOnline = true;
        } catch (error) {
            console.error("Supabase: não foi possível carregar os produtos.", error);
            supabaseOnline = false;
            toast("Não foi possível carregar as alterações online. Usando os dados locais.");
        }
    }

    function money(value) {
        return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    }

    // Converte preço digitado de forma segura.
    // Exemplos aceitos: 15 | 15,00 | 15.00 | R$ 15,00 | 1.250,50 | 1250.50
    // O preço é sempre salvo como um número decimal simples (ex.: 15).
    function parsePriceInput(value) {
        // IMPORTANTE: o preço é convertido UMA ÚNICA VEZ, diretamente do texto do campo.
        // Nunca fazemos conversões cumulativas (*100, /100 etc.).
        let raw = String(value ?? "").trim();
        if (!raw) return NaN;

        raw = raw.replace(/R\$/gi, "").replace(/\s/g, "").trim();
        if (!raw) return NaN;

        // Aceita 15,00 | 15.00 | 1.250,50 | 1250.50.
        if (raw.includes(",")) {
            raw = raw.replace(/\./g, "").replace(/,/g, ".");
        } else {
            // Sem vírgula, o ponto é decimal.
            // Ex.: 15.00 permanece 15.00.
            raw = raw.replace(/[^0-9.+-]/g, "");
        }

        const number = Number(raw);
        // Proteção contra valores corrompidos/notação científica gigantesca.
        if (!Number.isFinite(number) || number < 0 || number > 1000000) return NaN;

        return Number(number.toFixed(2));
    }

    function priceInputValue(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) return "0.00";
        return (Math.round(number * 100) / 100).toFixed(2);
    }

    function normalize(value) {
        return String(value || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeFlavors(value) {
        if (Array.isArray(value)) {
            return Array.from(new Set(value.map(v => String(v || "").trim()).filter(Boolean)));
        }
        return Array.from(new Set(
            String(value || "")
                .split(/[,;\n]+/)
                .map(v => v.trim())
                .filter(Boolean)
        ));
    }

    function productFlavors(name) {
        const data = getProduct(name);
        return normalizeFlavors(data.flavors);
    }

    function productQuantityInCart(name) {
        return cart
            .filter(item => item.produto === name)
            .reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
    }

    function escapeHTML(value) {
        const div = document.createElement("div");
        div.textContent = String(value ?? "");
        return div.innerHTML;
    }

    function toast(message) {
        let el = $("#toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "toast";
            el.className = "toast";
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.add("show");
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove("show"), 2500);
    }

    /* ===================== CARRINHO ===================== */
    function cartTotal() {
        return cart.reduce((sum, item) => sum + Number(item.preco) * Number(item.quantidade), 0);
    }

    function cartQuantity() {
        return cart.reduce((sum, item) => sum + Number(item.quantidade), 0);
    }

    function saveCart() { saveJSON(CART_KEY, cart); }

    function getBaseProduct(name) {
        const card = productCards().find(c => ($(".order-btn", c)?.dataset.product || "") === name);
        if (!card) return { price: 0, description: "", image: "", stock: null, category: "Outros" };
        const button = $(".order-btn", card);
        const priceText = (button?.dataset.price || "0").replace(",", ".");
        return {
            price: Number(priceText) || 0,
            description: $(".product-body p", card)?.textContent.trim() || "",
            image: "",
            stock: null,
            category: card.dataset.category || "Outros"
        };
    }

    function getProduct(name) {
        const base = getBaseProduct(name);
        const custom = productData[name] || {};
        const customCatalog = customProductByName(name);
        return {
            ...base,
            ...custom,
            ...(customCatalog?.category ? { category: customCatalog.category } : {}),
            ...(customCatalog?.flavors ? { flavors: normalizeFlavors(customCatalog.flavors) } : {})
        };
    }

    function isAvailable(name) {
        const data = getProduct(name);
        if (data.stock !== null && data.stock !== undefined && data.stock !== "") {
            return Number(data.stock) > 0;
        }
        return availability[name] !== false;
    }

    function availableStock(name) {
        const data = getProduct(name);
        if (data.stock === null || data.stock === undefined || data.stock === "") return Infinity;
        return Math.max(0, Number(data.stock) || 0);
    }

    function saveAvailability() {
        saveJSON(AVAIL_KEY, availability);
    }

    function productCards() {
        return $$(".product-card").filter(card => $(".order-btn", card));
    }

    function customProductByName(name) {
        const key = normalize(name);
        return customProducts.find(p => normalize(p.name) === key) || null;
    }

    function catalogProductNames() {
        const names = productCards().map(card => $(".order-btn", card)?.dataset.product || "").filter(Boolean);
        customProducts.forEach(product => {
            if (product?.name && !names.some(n => normalize(n) === normalize(product.name))) names.push(product.name);
        });
        return names;
    }

    function categoryLabel(category) {
        const labels = { fatias: "Fatias", gelados: "Bolo gelado", bombons: "Bombons" };
        return labels[category] || String(category || "Outros").replace(/\b\w/g, c => c.toUpperCase());
    }

    function categorySlug(category) {
        return normalize(category).replace(/\s+/g, "-") || "outros";
    }

    function registerCategory(category) {
        const value = String(category || "").trim();
        if (!value) return;
        if (!categories.some(c => normalize(c) === normalize(value))) {
            categories.push(value);
            saveJSON(CATEGORY_KEY, categories);
        }
    }

    function renderCategoryFilters() {
        const filters = $(".filters");
        if (!filters) return;
        const active = $(".filter.active")?.dataset.filter || "todos";
        filters.innerHTML = "";
        const all = document.createElement("button");
        all.type = "button";
        all.className = "filter" + (active === "todos" ? " active" : "");
        all.dataset.filter = "todos";
        all.textContent = "Todos";
        filters.appendChild(all);
        categories.forEach(category => {
            const filter = document.createElement("button");
            filter.type = "button";
            filter.className = "filter" + (active === categorySlug(category) ? " active" : "");
            filter.dataset.filter = categorySlug(category);
            filter.dataset.managedCategory = "true";
            filter.textContent = categoryLabel(category);
            filters.appendChild(filter);
        });
    }

    function ensureCategoryFilter(category) {
        registerCategory(category);
        renderCategoryFilters();
        return categorySlug(category);
    }

    function renderCustomProducts() {
        const container = $("#allProducts");
        if (!container) return;
        $$(".custom-product-card", container).forEach(card => card.remove());
        customProducts.forEach(product => {
            const category = ensureCategoryFilter(product.category);
            const card = document.createElement("article");
            card.className = "product-card custom-product-card";
            card.dataset.category = category;
            card.dataset.customProduct = "true";
            const image = product.image
                ? '<img src="' + escapeHTML(product.image) + '" alt="' + escapeHTML(product.name) + '" class="custom-product-image">'
                : '<div class="custom-product-placeholder">🍰</div>';
            card.innerHTML =
                '<div class="product-image custom-product-image-wrap">' + image + '</div>' +
                '<div class="product-body">' +
                    '<span class="tag">' + escapeHTML(categoryLabel(product.category)) + '</span>' +
                    '<h3>' + escapeHTML(product.name) + '</h3>' +
                    '<p>' + escapeHTML(product.description || "Delícia preparada com carinho pela Puro Amor.") + '</p>' +
                    (product.weight ? '<div class="product-weight">Peso: ' + escapeHTML(product.weight) + '</div>' : '') +
                    (normalizeFlavors(product.flavors).length ? '<div class="product-flavors">Sabores: ' + escapeHTML(normalizeFlavors(product.flavors).join(", ")) + '</div>' : '') +
                    '<div class="product-bottom"><strong>' + money(product.price) + '</strong>' +
                    '<button class="order-btn" type="button" data-product="' + escapeHTML(product.name) + '" data-price="' + Number(product.price) + '">Pedir</button></div>' +
                '</div>';
            container.appendChild(card);
        });
    }

    function saveCustomProducts() { saveJSON(CUSTOM_PRODUCTS_KEY, customProducts); }
    function saveRemovedProducts() { saveJSON(REMOVED_PRODUCTS_KEY, removedProducts); }

    function getFeatured(name) {
        const item = featured[name] || {};
        return { novidade: item.novidade === true, maisPedidos: item.maisPedidos === true };
    }
    function saveFeatured() { saveJSON(FEATURED_KEY, featured); }
    function setFeatured(name, novidade, maisPedidos) {
        featured[name] = { novidade: !!novidade, maisPedidos: !!maisPedidos };
        saveFeatured();
    }
    function renderFeatured() {
        const grids = [$("#novidadesGrid"), $("#maisPedidosGrid")];
        const sections = [$("#novidadesSection"), $("#maisPedidosSection")];
        if (!grids[0] || !grids[1]) return;
        grids.forEach(grid => grid.innerHTML = "");
        productCards().forEach(card => {
            const name = $(".order-btn", card)?.dataset.product || "";
            if (!name || card.classList.contains("product-removed")) return;
            const flags = getFeatured(name);
            if (flags.novidade) { const clone = card.cloneNode(true); clone.classList.add("featured-clone"); clone.dataset.featuredName = name; grids[0].appendChild(clone); }
            if (flags.maisPedidos) { const clone = card.cloneNode(true); clone.classList.add("featured-clone"); clone.dataset.featuredName = name; grids[1].appendChild(clone); }
        });
        sections.forEach((section, i) => { if (section) section.style.display = grids[i].children.length ? "" : "none"; });
    }
    function updateFeaturedVisibility() {
        const term = normalize($("#productSearch")?.value || "");
        const activeFilter = $(".filter.active")?.dataset.filter || "todos";
        $$(".featured-clone").forEach(clone => {
            const name = clone.dataset.featuredName || "";
            const source = productCards().find(c => $(".order-btn", c)?.dataset.product === name);
            if (!source) { clone.style.display = "none"; return; }
            const category = normalize(source.dataset.category || "").replace(/\s+/g, "-");
            const description = source.dataset.productDescription || $("p", source)?.textContent || "";
            const haystack = normalize(name + " " + description + " " + (source.dataset.category || ""));
            const ok = (activeFilter === "todos" || category === activeFilter) && (!term || haystack.includes(term)) && !source.classList.contains("product-unavailable") && !source.classList.contains("product-removed");
            clone.style.display = ok ? "" : "none";
        });
        ["#novidadesSection", "#maisPedidosSection"].forEach(sel => {
            const section = $(sel);
            if (section) section.style.display = $$(sel + " .featured-clone").some(c => c.style.display !== "none") ? "" : "none";
        });
    }

    function applyRemovedProducts() {
        productCards().forEach(card => {
            const name = $(".order-btn", card)?.dataset.product || "";
            card.classList.toggle("product-removed", removedProducts.includes(name));
        });
    }

    async function restoreProduct(name) {
        removedProducts = removedProducts.filter(x => x !== name);
        saveRemovedProducts();
        const synced = await saveProductOnline(name);
        applyRemovedProducts();
        renderAvailability();
        prepareSearchData();
        renderFeatured();;
        runSearch();
        renderAdminList();
        toast(name + " voltou para o cardápio! ❤️");
    }

    async function removeProduct(name) {
        const product = customProductByName(name);
        if (!confirm('Remover "' + name + '" do cardápio?')) return;
        if (product) {
            customProducts = customProducts.filter(p => p.name !== name);
            saveCustomProducts();
        } else if (!removedProducts.includes(name)) {
            removedProducts.push(name);
            saveRemovedProducts();
        }
        delete productData[name];
        delete availability[name];
        favorites = favorites.filter(x => x !== name);
        cart = cart.filter(item => item.produto !== name);
        saveJSON(PRODUCT_KEY, productData);
        saveAvailability();
        saveJSON(FAV_KEY, favorites);
        saveCart();
        renderCustomProducts();
        applyRemovedProducts();
        prepareSearchData();
        renderFeatured();
        renderFavoriteButtons();
        renderAvailability();
        renderCart();
        runSearch();
        renderAdminList();
        if (product) await removeProductOnline(name);
        toast(name + " removido do cardápio.");
    }

    function renderRemovedProducts() {
        const box = $("#adminRemovedList");
        if (!box) return;
        box.innerHTML = removedProducts.length
            ? removedProducts.map(name => '<div class="admin-removed-item"><span>' + escapeHTML(name) + '</span><button type="button" class="admin-restore-btn" data-restore-product="' + escapeHTML(name) + '">Restaurar</button></div>').join("")
            : '<p class="admin-note">Nenhum produto removido.</p>';
    }

    async function addNewProduct() {
        const name = $("#newProductName")?.value.trim();
        const priceRaw = $("#newProductPrice")?.value.trim() || "";
        const price = parsePriceInput(priceRaw);
        const stockRaw = $("#newProductStock")?.value.trim() || "";
        const categoryText = $("#newProductCategory")?.value.trim() || "Outros";
        const weight = $("#newProductWeight")?.value.trim() || "";
        const flavors = normalizeFlavors($("#newProductFlavors")?.value || "");
        const description = $("#newProductDescription")?.value.trim() || "";
        const imageURL = $("#newProductImageURL")?.value.trim() || "";
        const fileInput = $("#newProductImageFile");

        if (!name) { toast("Digite o nome do produto."); return; }
        if (!priceRaw || !Number.isFinite(price) || price < 0 || price > 1000000) { toast("Digite um preço válido. Ex.: 15,00"); return; }
        if (customProducts.some(p => normalize(p.name) === normalize(name)) || productCards().some(c => normalize($(".order-btn", c)?.dataset.product) === normalize(name))) {
            toast("Já existe um produto com esse nome."); return; }

        let stock = null;
        if (stockRaw !== "") {
            stock = parseInt(stockRaw.replace(/[^0-9-]/g, ""), 10);
            if (!Number.isFinite(stock) || stock < 0) { toast("Digite uma quantidade válida."); return; }
        }

        const category = categoryText;
        let image = imageURL;
        const file = fileInput?.files?.[0];

        if (!image && file) {
            try {
                image = await compressImage(file);
            } catch (error) {
                console.error("Erro ao carregar a foto do novo produto:", error);
                toast("A foto não pôde ser carregada. O produto será cadastrado sem foto.");
                image = "";
            }
        }

        registerCategory(category);
        const product = {
            id: "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            name, price, stock, category, weight, flavors, description, image,
            createdAt: new Date().toISOString()
        };
        customProducts.push(product);
        productData[name] = { price, stock, category, weight, flavors, description, image, novidade: false, maisPedidos: false, customId: product.id };
        availability[name] = stock === 0 ? false : true;

        saveCustomProducts();
        saveJSON(PRODUCT_KEY, productData);
        saveAvailability();
        const synced = await saveProductOnline(name);

        // Recria o card no catálogo público e trata o produto novo como os demais.
        renderCustomProducts();
        prepareSearchData();

        // Depois de cadastrar, volta para "Todos" para o novo produto ficar visível
        // mesmo que o dono estivesse usando outro filtro do cardápio.
        const todosFiltro = $('.filter[data-filter="todos"]');
        if (todosFiltro) {
            $$(".filter").forEach(f => f.classList.remove("active"));
            todosFiltro.classList.add("active");
        }

        // Garante que o novo card receba exatamente os mesmos recursos dos produtos originais.
        const novoCard = productCards().find(card =>
            normalize($('.order-btn', card)?.dataset.product) === normalize(name)
        );
        if (novoCard) {
            novoCard.style.display = "";
            novoCard.classList.remove("product-removed", "product-unavailable");
            if (!$('.product-details-btn', novoCard)) {
                const body = $('.product-body', novoCard);
                if (body) {
                    const detalhes = document.createElement("button");
                    detalhes.type = "button";
                    detalhes.className = "product-details-btn";
                    detalhes.textContent = "Ver detalhes";
                    body.appendChild(detalhes);
                }
            }
        }

        renderFeatured();
        renderFavoriteButtons();
        renderAvailability();
        renderCart();
        prepareSearchData();
        runSearch();
        renderAdminList();

        // Limpa o formulário para facilitar o próximo cadastro.
        $("#newProductName") && ($("#newProductName").value = "");
        $("#newProductPrice") && ($("#newProductPrice").value = "");
        $("#newProductStock") && ($("#newProductStock").value = "");
        $("#newProductCategory") && ($("#newProductCategory").value = "");
        $("#newProductWeight") && ($("#newProductWeight").value = "");
        $("#newProductFlavors") && ($("#newProductFlavors").value = "");
        $("#newProductDescription") && ($("#newProductDescription").value = "");
        $("#newProductImageURL") && ($("#newProductImageURL").value = "");
        if (fileInput) fileInput.value = "";

        toast(name + " foi adicionado ao cardápio! ❤️");
    }

    function renderAvailability() {
        productCards().forEach(card => {
            const button = $(".order-btn", card);
            const name = button.dataset.product || "Produto";
            const data = getProduct(name);
            const available = isAvailable(name);
            registerCategory(data.category);
            card.dataset.category = categorySlug(data.category);
            button.dataset.price = String(data.price);
            button.disabled = !available;
            button.textContent = available ? "Pedir" : "Indisponível";
            button.setAttribute("aria-disabled", String(!available));
            card.classList.toggle("product-unavailable", !available);

            const priceEl = $(".product-bottom strong", card);
            if (priceEl) priceEl.textContent = money(data.price);
            const descEl = $(".product-body p", card);
            if (descEl && data.description) descEl.textContent = data.description;

            let weightEl = $(".product-weight", card);
            if (data.weight) {
                if (!weightEl) {
                    weightEl = document.createElement("div");
                    weightEl.className = "product-weight";
                    const body = $(".product-body", card);
                    if (body && descEl) body.insertBefore(weightEl, descEl.nextSibling);
                    else if (body) body.insertBefore(weightEl, body.firstChild);
                }
                weightEl.textContent = "Peso: " + data.weight;
            } else if (weightEl) {
                weightEl.remove();
            }

            const imageEl = $(".product-image", card);
            if (imageEl && data.image) {
                imageEl.innerHTML = '<img src="' + escapeHTML(data.image) + '" alt="' + escapeHTML(name) + '" class="custom-product-image">';
            }

            let badge = $(".stock-badge", card);
            if (!available) {
                if (!badge) {
                    badge = document.createElement("div");
                    badge.className = "stock-badge";
                    const body = $(".product-body", card);
                    if (body) body.insertBefore(badge, body.firstChild);
                }
                badge.textContent = "INDISPONÍVEL NO MOMENTO";
            } else if (badge) badge.remove();

            let stockInfo = $(".stock-info", card);
            const stock = data.stock;
            if (stock !== null && stock !== undefined && stock !== "") {
                if (!stockInfo) {
                    stockInfo = document.createElement("small");
                    stockInfo.className = "stock-info";
                    const body = $(".product-body", card);
                    if (body) body.appendChild(stockInfo);
                }
                stockInfo.textContent = available ? "" + stock + " unidade(s) disponível(is)" : "Sem estoque";
                stockInfo.style.display = "block";
            } else if (stockInfo) stockInfo.remove();
        });
    }

    function unavailableCartItems() {
        return cart.filter(item => !isAvailable(item.produto));
    }

    async function getAdminSession() {
        if (!supabaseClient) return null;
        try {
            const { data, error } = await supabaseClient.auth.getSession();
            if (error) throw error;
            return data?.session || null;
        } catch (error) {
            console.error("Supabase Auth: não foi possível verificar a sessão.", error);
            return null;
        }
    }

    async function signInAdmin() {
        if (!supabaseClient) {
            toast("O sistema de login não está disponível.");
            return null;
        }

        const email = window.prompt("Painel do dono\n\nDigite seu e-mail autorizado:");
        if (email === null) return null;
        const normalizedEmail = email.trim().toLowerCase();
        if (!AUTHORIZED_ADMIN_EMAILS.has(normalizedEmail)) {
            toast("Este e-mail não está autorizado para o painel.");
            return null;
        }

        const password = window.prompt("Digite a senha da sua conta Supabase:");
        if (password === null) return null;
        if (!password) {
            toast("Digite a senha para entrar.");
            return null;
        }

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: normalizedEmail,
            password
        });
        if (error) {
            console.error("Supabase Auth: falha no login.", error);
            toast("Não foi possível entrar. Confira o e-mail e a senha.");
            return null;
        }

        const loggedEmail = String(data?.user?.email || "").toLowerCase();
        if (!AUTHORIZED_ADMIN_EMAILS.has(loggedEmail)) {
            await supabaseClient.auth.signOut();
            toast("Esta conta não está autorizada para o painel.");
            return null;
        }
        return data?.session || null;
    }

    async function openAdmin() {
        if (!supabaseClient) {
            toast("Não foi possível carregar o login do painel.");
            return;
        }

        let session = await getAdminSession();
        let loggedEmail = String(session?.user?.email || "").toLowerCase();
        if (!session || !AUTHORIZED_ADMIN_EMAILS.has(loggedEmail)) {
            if (session) await supabaseClient.auth.signOut();
            session = await signInAdmin();
            if (!session) return;
            loggedEmail = String(session?.user?.email || "").toLowerCase();
        }

        let modal = $("#adminModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "adminModal";
            modal.className = "admin-modal";
            modal.innerHTML = '<div class="modal-card admin-card"><button type="button" class="modal-close" data-close="adminModal">×</button><span class="eyebrow">PURO AMOR</span><h2>Painel do dono</h2><p class="admin-note">Conta autorizada: <strong id="adminLoggedEmail"></strong></p><div class="admin-actions" style="margin-bottom:16px"><button type="button" class="admin-remove-btn" id="adminLogoutBtn">Sair da conta</button></div><p class="admin-note">Gerencie o cardápio sem alterar o código. Você pode editar produtos, adicionar novos e remover os produtos criados pelo painel.</p><div class="admin-new-product"><h3>➕ Adicionar novo produto</h3><div class="admin-new-grid"><label>Nome<input id="newProductName" type="text" placeholder="Ex.: Brownie especial"></label><label>Preço (R$)<input id="newProductPrice" type="text" inputmode="decimal" placeholder="15,00"></label><label>Quantidade<input id="newProductStock" type="number" min="0" step="1" placeholder="Sem limite"></label><label>Categoria<input id="newProductCategory" list="adminCategoryOptions" type="text" placeholder="Ex.: Bolos"></label><label>Peso<input id="newProductWeight" type="text" inputmode="text" placeholder="Ex.: 500 g, 1 kg, 120 ml"></label><label class="admin-wide">Sabores (opcional)<textarea id="newProductFlavors" rows="3" placeholder="Ex.: Brigadeiro, Ninho, Morango, Nutella&#10;Você também pode colocar um sabor por linha."></textarea></label><datalist id="adminCategoryOptions"></datalist><label class="admin-wide">Descrição<textarea id="newProductDescription" rows="3" placeholder="Descrição do produto"></textarea></label><label class="admin-wide">URL da foto<input id="newProductImageURL" type="url" placeholder="https://..."></label><label class="admin-wide image-upload-label">Ou escolha uma foto do computador<input id="newProductImageFile" type="file" accept="image/*"></label></div><div class="admin-actions"><button type="button" class="admin-save-btn" id="addNewProductBtn">Adicionar ao cardápio</button></div></div><div class="admin-categories"><h3 class="admin-section-title">Categorias do cardápio</h3><p class="admin-note">Adicione novas categorias para elas aparecerem automaticamente nos filtros do cardápio. Você também pode renomear ou excluir categorias que não estejam sendo usadas.</p><div class="admin-new-grid"><label>Nova categoria<input id="newCategoryName" type="text" placeholder="Ex.: Brownies"></label></div><div class="admin-actions"><button type="button" class="admin-save-btn" id="addCategoryBtn">Adicionar categoria</button></div><div id="adminCategoryList" class="admin-coupon-list"></div></div><div class="admin-coupons"><h3 class="admin-section-title">Cupons autorizados</h3><p class="admin-note">Somente os cupons cadastrados aqui e marcados como ativos poderão ser usados pelos clientes.</p><div class="admin-new-grid"><label>Código do cupom<input id="newCouponCode" type="text" placeholder="Ex.: BOLO10" maxlength="30"></label><label>Tipo de desconto<select id="newCouponType"><option value="percent">Porcentagem (%)</option><option value="fixed">Valor fixo (R$)</option></select></label><label>Desconto<input id="newCouponValue" type="number" min="0.01" step="0.01" placeholder="10"></label></div><div class="admin-actions"><button type="button" class="admin-save-btn" id="addAuthorizedCouponBtn">Autorizar cupom</button></div><div id="adminCouponList" class="admin-coupon-list"></div></div><div class="admin-sales"><h3 class="admin-section-title">Relatório de vendas</h3><p class="admin-note">Resumo dos pedidos enviados pelo site neste navegador. O frete de entregas fica fora do valor de vendas até a confirmação da loja.</p><div id="adminSalesReport"></div><div class="admin-actions"><button type="button" class="admin-save-btn" id="refreshSalesReport">Atualizar relatório</button><button type="button" class="admin-remove-btn" id="clearSalesHistory">Apagar histórico</button></div></div><h3 class="admin-section-title">Produtos do cardápio</h3><div id="adminProductList" class="admin-list"></div><h3 class="admin-section-title admin-removed-title">Produtos removidos</h3><div id="adminRemovedList" class="admin-removed-list"></div></div>';
            document.body.appendChild(modal);

            $("#adminLogoutBtn", modal)?.addEventListener("click", async () => {
                try { await supabaseClient.auth.signOut(); } catch (_) {}
                modal.classList.remove("open");
                toast("Sessão encerrada.");
            });
        }

        const emailBox = $("#adminLoggedEmail");
        if (emailBox) emailBox.textContent = loggedEmail;

        const addButton = $("#addNewProductBtn");
        if (addButton && !addButton.dataset.bound) {
            addButton.dataset.bound = "true";
            addButton.addEventListener("click", addNewProduct);
        }
        renderAdminList();
        renderSalesReport();
        modal.classList.add("open");
    }

    function renderAdminCategories() {
        const box = $("#adminCategoryList");
        const datalist = $("#adminCategoryOptions");
        if (datalist) datalist.innerHTML = categories.map(c => '<option value="' + escapeHTML(c) + '"></option>').join("");
        if (!box) return;
        box.innerHTML = categories.map((category, index) => {
            const used = productCards().some(card => categorySlug(getProduct($(".order-btn", card)?.dataset.product || "").category) === categorySlug(category));
            return '<div class="admin-coupon-item"><div><strong>' + escapeHTML(categoryLabel(category)) + '</strong><span>' + (used ? 'Em uso no cardápio' : 'Sem produtos') + '</span></div><div class="admin-actions"><button type="button" class="admin-save-btn" data-rename-category="' + index + '">Renomear</button><button type="button" class="admin-remove-btn" data-remove-category="' + index + '">Excluir</button></div></div>';
        }).join("");
    }

    function addCategory() {
        const input = $("#newCategoryName");
        const value = input?.value.trim() || "";
        if (!value) { toast("Digite o nome da categoria."); return; }
        if (normalize(value) === "todos") { toast("Esse nome é reservado para o filtro Todos."); return; }
        if (categories.some(c => normalize(c) === normalize(value))) { toast("Essa categoria já existe."); return; }
        categories.push(value);
        saveJSON(CATEGORY_KEY, categories);
        renderCategoryFilters();
        renderAdminCategories();
        if (input) input.value = "";
        toast("Categoria " + value + " adicionada.");
    }

    function renameCategory(index) {
        const oldName = categories[index];
        if (!oldName) return;
        const value = window.prompt("Novo nome para a categoria:", oldName)?.trim();
        if (!value) return;
        if (normalize(value) === "todos") { toast("Esse nome é reservado para o filtro Todos."); return; }
        if (categories.some((c, i) => i !== index && normalize(c) === normalize(value))) { toast("Essa categoria já existe."); return; }
        productCards().forEach(card => {
            const button = $(".order-btn", card);
            const name = button?.dataset.product;
            if (!name) return;
            if (normalize(getProduct(name).category) === normalize(oldName)) productData[name] = { ...(productData[name] || {}), category: value };
        });
        customProducts.forEach(product => { if (normalize(product.category) === normalize(oldName)) product.category = value; });
        categories[index] = value;
        saveJSON(CATEGORY_KEY, categories);
        saveJSON(PRODUCT_KEY, productData);
        saveCustomProducts();
        renderCustomProducts();
        renderAvailability();
        renderCategoryFilters();
        prepareSearchData();
        renderFeatured();
        renderFavoriteButtons();
        runSearch();
        renderAdminList();
        toast("Categoria renomeada com sucesso.");
    }

    function removeCategory(index) {
        const name = categories[index];
        if (!name) return;
        const used = productCards().some(card => categorySlug(getProduct($(".order-btn", card)?.dataset.product || "").category) === categorySlug(name));
        if (used) { toast("Não é possível excluir uma categoria que possui produtos. Renomeie ou mova os produtos primeiro."); return; }
        if (!confirm('Excluir a categoria "' + name + '"?')) return;
        categories.splice(index, 1);
        saveJSON(CATEGORY_KEY, categories);
        renderCategoryFilters();
        renderAdminCategories();
        toast("Categoria excluída.");
    }

    function renderAdminList() {
        const box = $("#adminProductList");
        if (!box) return;
        box.innerHTML = catalogProductNames().map(name => {
            const card = productCards().find(c => $(".order-btn", c)?.dataset.product === name);
            const button = card ? $(".order-btn", card) : null;
            const data = getProduct(name);
            const available = isAvailable(name);
            const isCustom = !!customProductByName(name);
            return '<section class="admin-product editor-card" data-admin-product="' + escapeHTML(name) + '">' +
                '<div class="admin-product-title"><strong>' + escapeHTML(name) + '</strong><span class="admin-stock-label">' + (available ? 'Disponível' : 'Indisponível') + '</span></div>' +
                '<label>Preço (R$)<input type="text" inputmode="decimal" data-edit-price data-name="' + escapeHTML(name) + '" value="' + priceInputValue(data.price) + '"></label>' +
                '<label>Quantidade disponível<input type="number" min="0" step="1" data-edit-stock data-name="' + escapeHTML(name) + '" value="' + (data.stock === null || data.stock === undefined ? '' : Number(data.stock)) + '" placeholder="Sem limite"></label>' +
                '<label>Categoria<input type="text" list="adminCategoryOptions" data-edit-category data-name="' + escapeHTML(name) + '" value="' + escapeHTML(data.category || "Outros") + '" placeholder="Categoria"></label>' +
                '<label>Peso<input type="text" inputmode="text" data-edit-weight data-name="' + escapeHTML(name) + '" value="' + escapeHTML(data.weight || '') + '" placeholder="Ex.: 500 g, 1 kg, 120 ml"></label>' +
                '<label>Sabores (opcional)<textarea rows="3" data-edit-flavors data-name="' + escapeHTML(name) + '" placeholder="Ex.: Brigadeiro, Ninho, Morango, Nutella">' + escapeHTML(normalizeFlavors(data.flavors).join(", ")) + '</textarea></label>' +
                '<div class="admin-feature-options"><span>Destacar no cardápio</span><label><input type="checkbox" data-edit-novidade data-name="' + escapeHTML(name) + '" ' + (getFeatured(name).novidade ? 'checked' : '') + '> ✨ Novidade</label><label><input type="checkbox" data-edit-mais-pedidos data-name="' + escapeHTML(name) + '" ' + (getFeatured(name).maisPedidos ? 'checked' : '') + '> 🔥 Mais pedidos</label></div>' +
                '<label>Descrição<textarea rows="3" data-edit-description data-name="' + escapeHTML(name) + '">' + escapeHTML(data.description) + '</textarea></label>' +
                '<label>URL da foto<input type="url" data-edit-image-url data-name="' + escapeHTML(name) + '" value="' + escapeHTML(data.image && !data.image.startsWith("data:") ? data.image : '') + '" placeholder="https://..."></label>' +
                '<label class="image-upload-label">Ou escolha uma foto do computador<input type="file" accept="image/*" data-edit-image-file data-name="' + escapeHTML(name) + '"></label>' +
                '<div class="admin-image-preview" data-preview="' + escapeHTML(name) + '">' + (data.image ? '<img src="' + escapeHTML(data.image) + '" alt="Prévia">' : '<span>Sem foto personalizada</span>') + '</div>' +
                '<div class="admin-actions"><button type="button" class="availability-btn ' + (available ? '' : 'off') + '" data-toggle-stock="' + escapeHTML(name) + '">' + (available ? 'Marcar indisponível' : 'Tornar disponível') + '</button><button type="button" class="admin-save-btn" data-save-product="' + escapeHTML(name) + '">Salvar alterações</button>' + '<button type="button" class="admin-remove-btn" data-remove-product="' + escapeHTML(name) + '">Remover produto</button>' + '</div>' +
                '<small class="admin-custom-label">' + (isCustom ? 'Produto criado pelo painel' : 'Produto original do site') + '</small>' +
                '</section>';
        }).join("");
        renderRemovedProducts();
        renderAdminCoupons();
        renderAdminCategories();
    }

    async function saveProductEditor(name) {
        const priceField = $("[data-edit-price][data-name=\"" + CSS.escape(name) + "\"]");
        const priceRaw = priceField?.value.trim() || "";
        const price = parsePriceInput(priceRaw);
        const stockRaw = $("[data-edit-stock][data-name=\"" + CSS.escape(name) + "\"]")?.value.trim();
        const description = $("[data-edit-description][data-name=\"" + CSS.escape(name) + "\"]")?.value.trim() || "";
        const category = $("[data-edit-category][data-name=\"" + CSS.escape(name) + "\"]")?.value.trim() || "Outros";
        const weight = $("[data-edit-weight][data-name=\"" + CSS.escape(name) + "\"]")?.value.trim() || "";
        const flavors = normalizeFlavors($("[data-edit-flavors][data-name=\"" + CSS.escape(name) + "\"]")?.value || "");
        const novidade = $("[data-edit-novidade][data-name=\"" + CSS.escape(name) + "\"]")?.checked === true;
        const maisPedidos = $("[data-edit-mais-pedidos][data-name=\"" + CSS.escape(name) + "\"]")?.checked === true;
        const imageURL = $("[data-edit-image-url][data-name=\"" + CSS.escape(name) + "\"]")?.value.trim() || "";
        if (!Number.isFinite(price) || price < 0 || price > 1000000) { toast("Digite um preço válido para " + name + ". Ex.: 15,00"); return; }
        let stock = stockRaw === "" ? null : Math.max(0, parseInt(stockRaw, 10));
        if (stockRaw !== "" && !Number.isFinite(stock)) { toast("Digite uma quantidade válida para " + name + "."); return; }
        registerCategory(category);
        productData[name] = { ...(productData[name] || {}), price, stock, description, category, weight, flavors, novidade, maisPedidos, image: imageURL || (productData[name]?.image || "") };
        const customEdited = customProductByName(name);
        if (customEdited) { customEdited.weight = weight; customEdited.flavors = flavors; customEdited.category = category; customEdited.description = description; customEdited.price = price; customEdited.stock = stock; customEdited.image = productData[name].image || ""; saveCustomProducts(); }
        setFeatured(name, novidade, maisPedidos);
        if (stock === 0) availability[name] = false;
        else if (stock === null || stock > 0) availability[name] = true;
        saveJSON(PRODUCT_KEY, productData);
        saveAvailability();
        const synced = await saveProductOnline(name);
        renderAvailability();
        prepareSearchData();
        renderFeatured();
        renderFavoriteButtons();
        runSearch();
        renderAdminList();
        toast(synced ? name + " atualizado e sincronizado online! ❤️" : name + " atualizado neste navegador, mas não foi sincronizado online.");
    }

    async function toggleAvailability(name) {
        availability[name] = !isAvailable(name);
        if (availability[name] && productData[name]?.stock === 0) productData[name].stock = 1;
        saveAvailability();
        saveJSON(PRODUCT_KEY, productData);
        const synced = await saveProductOnline(name);
        renderAvailability();
        renderAdminList();
        runSearch();
        toast(synced ? name + " cadastrado e sincronizado online! ❤️" : name + " cadastrado neste navegador, mas não foi sincronizado online.");
    }

    function compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type || !file.type.startsWith("image/")) {
                reject(new Error("Arquivo não é uma imagem."));
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const max = 1200;
                        const largest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
                        const scale = largest > max ? max / largest : 1;
                        const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
                        const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) { reject(new Error("Canvas indisponível.")); return; }
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataURL = canvas.toDataURL("image/jpeg", .82);
                        if (!dataURL || dataURL.length < 100) {
                            reject(new Error("Imagem vazia."));
                            return;
                        }
                        resolve(dataURL);
                    } catch (error) {
                        reject(error);
                    }
                };
                img.onerror = () => reject(new Error("Formato não suportado pelo navegador."));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
            reader.readAsDataURL(file);
        });
    }

    function loadImageFile(input) {
        const file = input?.files?.[0];
        if (!file) return;

        const name = input.dataset.name;
        const preview = $(`[data-preview="${CSS.escape(name)}"]`);
        const oldHTML = preview?.innerHTML || "";

        if (!file.type.startsWith("image/")) {
            toast("Escolha um arquivo de imagem (JPG, PNG, WEBP etc.).");
            input.value = "";
            return;
        }

        if (file.size > 15 * 1024 * 1024) {
            toast("Essa foto é muito grande. Escolha uma imagem de até 15 MB.");
            input.value = "";
            return;
        }

        if (preview) preview.innerHTML = "<span>Carregando foto...</span>";

        compressImage(file).then(dataURL => {
            productData[name] = { ...(productData[name] || getBaseProduct(name)), image: dataURL };
            saveJSON(PRODUCT_KEY, productData);
            if (preview) preview.innerHTML = '<img src="' + escapeHTML(dataURL) + '" alt="Prévia">';
            renderProductImages();
            toast("Foto carregada! Clique em Salvar alterações. ❤️");
        }).catch(error => {
            console.error("Erro ao carregar foto:", error);
            if (preview) preview.innerHTML = oldHTML || "<span>Sem foto personalizada</span>";
            input.value = "";
            toast("Não foi possível carregar essa foto. Tente JPG, PNG ou WEBP.");
        });
    }

    function openCart() {
        $("#cartPanel")?.classList.add("open");
        $("#cartOverlay")?.classList.add("open");
        document.body.classList.add("cart-open");
    }

    function closeCart() {
        $("#cartPanel")?.classList.remove("open");
        $("#cartOverlay")?.classList.remove("open");
        document.body.classList.remove("cart-open");
    }

    function renderCart() {
        const box = $("#cartItems");
        const count = $("#cartCount");
        const total = $("#cartTotal");
        const clear = $("#cartClear");
        const checkout = $("#cartCheckout");
        if (!box) return;

        if (!cart.length) {
            box.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><h3>Seu carrinho está vazio</h3><p>Escolha uma delícia no cardápio.</p><button type="button" class="cart-empty-btn" data-cart-empty>Ver cardápio</button></div>';
        } else {
            box.innerHTML = cart.map((item, i) => {
                const subtotal = Number(item.preco) * Number(item.quantidade);
                return '<article class="cart-item">' +
                    '<div class="cart-item-main"><div class="cart-item-icon">🍰</div><div class="cart-item-info"><strong>' + escapeHTML(item.produto) + '</strong>' + (item.sabor ? '<span class="cart-item-flavor">Sabor: ' + escapeHTML(item.sabor) + '</span>' : '') + '<span>' + money(item.preco) + ' cada</span></div></div>' +
                    '<div class="cart-item-bottom"><div class="quantity-control"><button type="button" class="cart-action" data-cart="minus" data-index="' + i + '">−</button><b>' + item.quantidade + '</b><button type="button" class="cart-action" data-cart="plus" data-index="' + i + '">+</button></div><strong class="cart-subtotal">' + money(subtotal) + '</strong><button type="button" class="cart-remove cart-action" data-cart="remove" data-index="' + i + '" aria-label="Remover">×</button></div>' +
                    '</article>';
            }).join("");
        }

        if (count) count.textContent = cartQuantity();
        if (total) total.textContent = money(cartTotal());
        if (clear) clear.disabled = !cart.length;
        if (checkout) checkout.disabled = !cart.length;
    }

    function openFlavorSelector(name, price) {
        const flavors = productFlavors(name);
        if (!flavors.length) {
            addToCart(name, price, "");
            return;
        }

        let modal = $("#flavorModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "flavorModal";
            modal.className = "details-modal flavor-modal";
            modal.innerHTML = '<div class="modal-card flavor-card"><button type="button" class="modal-close" data-close="flavorModal">×</button><span class="eyebrow">PURO AMOR</span><h2 id="flavorModalTitle">Escolha o sabor</h2><p id="flavorModalDescription"></p><div id="flavorOptions" class="flavor-options"></div><div class="modal-actions"><button type="button" class="secondary-modal-btn" data-close="flavorModal">Cancelar</button><button type="button" class="primary-modal-btn" id="confirmFlavorBtn">Adicionar ao carrinho 🛒</button></div></div>';
            document.body.appendChild(modal);
        }

        $("#flavorModalTitle", modal).textContent = "Escolha o sabor";
        $("#flavorModalDescription", modal).textContent = name;
        $("#flavorOptions", modal).innerHTML = flavors.map(flavor =>
            '<label class="flavor-option"><input type="radio" name="puroAmorFlavor" value="' + escapeHTML(flavor) + '"><span>' + escapeHTML(flavor) + '</span></label>'
        ).join("");

        const confirm = $("#confirmFlavorBtn", modal);
        confirm.onclick = function () {
            const selected = $('input[name="puroAmorFlavor"]:checked', modal)?.value || "";
            if (!selected) {
                toast("Escolha um sabor antes de adicionar.");
                return;
            }
            modal.classList.remove("open");
            addToCart(name, price, selected);
            openCart();
        };

        modal.classList.add("open");
    }

    function addToCart(name, price, flavor) {
        const value = Number(String(price).replace(",", "."));
        if (!name || !Number.isFinite(value)) {
            toast("Produto ou preço inválido.");
            return;
        }
        if (!isAvailable(name)) {
            toast(name + " está indisponível no momento. 😔");
            return;
        }

        const flavors = productFlavors(name);
        if (flavors.length && !flavor) {
            openFlavorSelector(name, price);
            return;
        }
        if (flavor && !flavors.some(item => normalize(item) === normalize(flavor))) {
            toast("Escolha um sabor válido para " + name + ".");
            return;
        }

        const limit = availableStock(name);
        const currentTotal = productQuantityInCart(name);
        if (currentTotal >= limit) {
            if (limit !== Infinity) toast("Não há mais unidades disponíveis de " + name + ".");
            return;
        }

        const existing = cart.find(item =>
            item.produto === name && normalize(item.sabor || "") === normalize(flavor || "")
        );
        if (existing) {
            existing.quantidade += 1;
        } else {
            const item = { produto: name, preco: getProduct(name).price || value, quantidade: 1 };
            if (flavor) item.sabor = flavor;
            cart.push(item);
        }
        saveCart();
        renderCart();
        toast(name + (flavor ? " — " + flavor : "") + " foi adicionado ao carrinho! ❤️");
    }

    function changeCart(index, action) {
        const item = cart[index];
        if (!item) return;
        if (action === "plus") {
            const limit = availableStock(item.produto);
            const currentTotal = productQuantityInCart(item.produto);
            if (currentTotal >= limit) { toast("Quantidade máxima disponível: " + limit + "."); return; }
            item.quantidade += 1;
        }
        if (action === "minus") item.quantidade -= 1;
        if (action === "remove" || item.quantidade <= 0) cart.splice(index, 1);
        saveCart();
        renderCart();
    }

    /* ===================== CUPONS AUTORIZADOS ===================== */
    function normalizeCouponCode(value) {
        return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    }

    function getCoupon(code) {
        const normalized = normalizeCouponCode(code);
        return coupons.find(c => normalizeCouponCode(c.code) === normalized && c.active !== false) || null;
    }

    function couponDiscount(couponCode, subtotal) {
        const item = getCoupon(couponCode);
        if (!item) return 0;
        if (item.type === "fixed") return Math.min(subtotal, Math.max(0, Number(item.value) || 0));
        return Math.min(subtotal, subtotal * Math.max(0, Number(item.value) || 0) / 100);
    }

    function saveCoupons() { saveJSON(COUPON_KEY, coupons); }

    function renderAdminCoupons() {
        const box = $("#adminCouponList");
        if (!box) return;
        if (!coupons.length) {
            box.innerHTML = '<p class="admin-note">Nenhum cupom autorizado. Cadastre um cupom abaixo.</p>';
            return;
        }
        box.innerHTML = coupons.map(c => {
            const code = escapeHTML(c.code);
            const value = Number(c.value) || 0;
            const display = c.type === "fixed" ? money(value) : value + "%";
            return '<div class="admin-coupon-item">' +
                '<div><strong>' + code + '</strong><span>' + display + ' de desconto</span><small>' + (c.active !== false ? 'Ativo' : 'Desativado') + '</small></div>' +
                '<div class="admin-actions"><button type="button" class="availability-btn ' + (c.active !== false ? '' : 'off') + '" data-toggle-coupon="' + code + '">' + (c.active !== false ? 'Desativar' : 'Ativar') + '</button><button type="button" class="admin-remove-btn" data-remove-coupon="' + code + '">Remover</button></div>' +
                '</div>';
        }).join("");
    }

    function addAuthorizedCoupon() {
        const code = normalizeCouponCode($("#newCouponCode")?.value);
        const type = $("#newCouponType")?.value || "percent";
        const value = Number($("#newCouponValue")?.value);
        if (!code || code.length < 3) { toast("Digite um código de cupom válido."); return; }
        if (!/^[A-Z0-9_-]+$/.test(code)) { toast("Use apenas letras, números, hífen ou underline no cupom."); return; }
        if (!Number.isFinite(value) || value <= 0 || (type === "percent" && value > 100)) { toast("Digite um desconto válido."); return; }
        if (coupons.some(c => normalizeCouponCode(c.code) === code)) { toast("Esse cupom já está cadastrado."); return; }
        coupons.push({ code, type, value, active: true });
        saveCoupons();
        $("#newCouponCode").value = "";
        $("#newCouponValue").value = "";
        renderAdminCoupons();
        toast("Cupom " + code + " autorizado com sucesso.");
    }

    function toggleCoupon(code) {
        const item = coupons.find(c => normalizeCouponCode(c.code) === normalizeCouponCode(code));
        if (!item) return;
        item.active = item.active === false;
        saveCoupons();
        if (coupon && normalizeCouponCode(coupon) === normalizeCouponCode(code) && item.active === false) coupon = null;
        renderAdminCoupons();
        renderCheckout();
        toast(item.active ? "Cupom ativado." : "Cupom desativado.");
    }

    function removeCoupon(code) {
        const normalized = normalizeCouponCode(code);
        const item = coupons.find(c => normalizeCouponCode(c.code) === normalized);
        if (!item) return;
        if (!window.confirm("Remover o cupom " + normalized + "?")) return;
        coupons = coupons.filter(c => normalizeCouponCode(c.code) !== normalized);
        saveCoupons();
        if (coupon && normalizeCouponCode(coupon) === normalized) coupon = null;
        renderAdminCoupons();
        renderCheckout();
        toast("Cupom removido.");
    }

    /* ===================== CHECKOUT ===================== */
    function createCheckout() {
        let modal = $("#checkoutModal");
        if (modal) return modal;
        modal = document.createElement("div");
        modal.id = "checkoutModal";
        modal.className = "checkout-modal";
        modal.innerHTML = '<div class="modal-card"><button type="button" class="modal-close" data-close="checkoutModal">×</button><h2>Finalizar pedido ❤️</h2><p>Confira os dados antes de enviar para o WhatsApp.</p><div class="checkout-fields"><label>Nome<input id="clientName" type="text" placeholder="Seu nome"></label><label>Telefone<input id="clientPhone" type="tel" placeholder="(16) 99999-9999"></label><label>Entrega ou retirada<select id="orderType"><option value="Entrega">Entrega</option><option value="Retirada">Retirada</option></select></label><div id="deliveryAddressFields"><label>Endereço para entrega</label><p class="address-help">Informe somente a rua e o número. O frete varia de R$ 8,00 a R$ 12,00 conforme a distância e será confirmado pela loja.</p><div id="manualAddressFields"><label>Rua<input id="clientStreet" type="text" placeholder="Ex.: Rua Luís de Camões" autocomplete="street-address"></label><label>Número<input id="clientNumber" type="text" placeholder="Ex.: 250" inputmode="numeric"></label></div><input id="clientAddress" type="hidden"><div class="admin-note">Cidade de entrega: <strong>Sertãozinho - SP</strong></div></div><label id="pickupObservationLabel" style="display:none;">Observação para retirada<textarea id="pickupObservation" placeholder="Alguma observação?" ></textarea></label><div id="deliveryFeeMessage" class="coupon-message">Informe a rua e o número. O frete será confirmado pela loja após o envio do pedido.</div><label>Forma de pagamento<select id="paymentMethod"><option value="Pix">Pix</option><option value="Cartão">Cartão</option><option value="Dinheiro">Dinheiro</option></select></label><label>Quando deseja pagar<select id="paymentTiming"><option value="No instante do pedido">Pagar no instante do pedido</option><option value="Na entrega/retirada">Pagar na entrega/retirada</option></select></label><label>Cupom<div class="coupon-line"><input id="couponInput" placeholder="PURO10 ou AMOR5"><button type="button" id="couponApply">Aplicar</button></div></label><div id="couponMessage" class="coupon-message"></div></div><div id="checkoutSummary" class="checkout-summary"></div><div class="modal-actions"><button type="button" class="secondary-modal-btn" data-close="checkoutModal">Voltar</button><button type="button" class="primary-modal-btn" id="sendWhatsapp">Enviar pelo WhatsApp</button></div></div>';
        document.body.appendChild(modal);
        return modal;
    }


    function deliveryFeeByDistance() { return null; }

    function updateDeliveryMessage(text, ok = false) {
        const box = $("#deliveryFeeMessage");
        if (!box) return;
        box.textContent = text;
        box.classList.toggle("delivery-ready", ok);
    }

    function renderCheckout() {
        const box = $("#checkoutSummary");
        if (!box) return;
        const subtotal = cartTotal();
        if (coupon && !getCoupon(coupon)) {
            coupon = null;
            toast("O cupom selecionado não está mais autorizado pela loja.");
        }
        const discount = couponDiscount(coupon, subtotal);
        const type = $("#orderType")?.value || "Entrega";
        const fee = 0;
        const total = Math.max(0, subtotal - discount + fee);
        box.innerHTML = cart.map(item => '<div class="checkout-summary-row"><span>' + escapeHTML(item.quantidade + "x " + item.produto) + '</span><strong>' + money(item.preco * item.quantidade) + '</strong></div>').join("") +
            '<div class="checkout-summary-row"><span>Subtotal</span><strong>' + money(subtotal) + '</strong></div>' +
            (discount ? '<div class="checkout-summary-row discount-row"><span>Desconto ' + coupon + '</span><strong>- ' + money(discount) + '</strong></div>' : '') +
            (type === "Entrega" ? '<div class="checkout-summary-row"><span>Taxa de entrega</span><strong>A confirmar</strong></div>' : '') +
            '<div class="checkout-summary-row checkout-total"><span>' + (type === "Entrega" ? 'Total dos produtos' : 'Total') + '</span><strong>' + money(total) + '</strong></div>';
    }

    function getDeliveryAddressParts() {
        const street = $("#clientStreet")?.value.trim() || "";
        const number = $("#clientNumber")?.value.trim() || "";
        const full = [street, number, "Sertãozinho", "SP"].filter(Boolean).join(", ");
        const hidden = $("#clientAddress");
        if (hidden) hidden.value = full;
        return { street, number, full };
    }

    function updateCheckoutAddressFields() {
        const type = $("#orderType")?.value || "Entrega";
        const deliveryFields = $("#deliveryAddressFields");
        const pickupLabel = $("#pickupObservationLabel");
        if (deliveryFields) deliveryFields.style.display = type === "Entrega" ? "block" : "none";
        if (pickupLabel) pickupLabel.style.display = type === "Retirada" ? "block" : "none";
    }

    async function calculateDeliveryFee() {
        const type = $("#orderType")?.value || "Entrega";
        const parts = getDeliveryAddressParts();

        updateCheckoutAddressFields();

        if (type !== "Entrega") {
            deliveryFee = 0;
            updateDeliveryMessage("Retirada no local: sem taxa de entrega.", true);
            renderCheckout();
            return true;
        }

        deliveryFee = 0;

        if (!parts.street || !parts.number) {
            updateDeliveryMessage("Informe somente a rua e o número. O frete será confirmado pela loja.");
            renderCheckout();
            return false;
        }

        updateDeliveryMessage("Endereço registrado. O frete será confirmado pela loja após o envio do pedido.", true);
        renderCheckout();
        return true;
    }

    function openCheckout() {
        if (!cart.length) { toast("Adicione um produto ao carrinho primeiro."); return; }
        const unavailable = unavailableCartItems();
        if (unavailable.length) {
            toast("Há produto sem estoque no carrinho. Remova-o antes de finalizar.");
            return;
        }
        const modal = createCheckout();
        coupon = null;
        deliveryFee = 0;
        $("#clientName").value = "";
        $("#clientPhone").value = "";
        $("#clientStreet").value = "";
        $("#clientNumber").value = "";
        $("#clientAddress").value = "";
        $("#pickupObservation").value = "";
        $("#orderType").value = "Entrega";
        $("#paymentMethod").value = "Pix";
        $("#paymentTiming").value = "No instante do pedido";
        $("#couponInput").value = "";
        $("#couponMessage").textContent = "";
        updateCheckoutAddressFields();
        updateDeliveryMessage("Digite a rua e o número. O frete será confirmado pela loja.");
        renderCheckout();
        modal.classList.add("open");
    }

    function nextOrderNumber() {
        let current = parseInt(localStorage.getItem(ORDER_NUMBER_KEY) || "0", 10);
        if (!Number.isFinite(current) || current < 0) current = 0;
        current += 1;
        saveJSON(ORDER_NUMBER_KEY, current);
        return "PEDIDO #" + String(current).padStart(4, "0");
    }

    function recordOrder(order) {
        orderHistory.unshift(order);
        if (orderHistory.length > 200) orderHistory = orderHistory.slice(0, 200);
        saveJSON(ORDER_HISTORY_KEY, orderHistory);
        saveJSON(ORDER_KEY, order);
    }

    function consumeStock(items) {
        let changed = false;
        items.forEach(item => {
            const data = getProduct(item.produto);
            if (data.stock === null || data.stock === undefined || data.stock === "") return;
            const current = Math.max(0, Number(data.stock) || 0);
            const next = Math.max(0, current - Number(item.quantidade || 0));
            productData[item.produto] = { ...(productData[item.produto] || {}), stock: next };
            availability[item.produto] = next > 0;
            const custom = customProductByName(item.produto);
            if (custom) custom.stock = next;
            changed = true;
        });
        if (changed) {
            saveJSON(PRODUCT_KEY, productData);
            saveAvailability();
            saveCustomProducts();
            renderCustomProducts();
            renderAvailability();
            prepareSearchData();
        renderFeatured();
            renderFavoriteButtons();
            runSearch();
        }
    }

    function renderSalesReport() {
        const box = $("#adminSalesReport");
        if (!box) return;
        const orders = Array.isArray(orderHistory) ? orderHistory : [];
        const revenue = orders.reduce((sum, o) => sum + Number(o.totalProdutos ?? o.total ?? 0), 0);
        const units = orders.reduce((sum, o) => sum + (Array.isArray(o.itens) ? o.itens.reduce((n, i) => n + Number(i.quantidade || 0), 0) : 0), 0);
        const average = orders.length ? revenue / orders.length : 0;
        const deliveries = orders.filter(o => o.tipo === "Entrega").length;
        const pickups = orders.filter(o => o.tipo === "Retirada").length;
        const payments = {};
        const products = {};
        orders.forEach(o => {
            const pm = o.formaPagamento || "Não informado";
            payments[pm] = (payments[pm] || 0) + 1;
            (o.itens || []).forEach(i => products[i.produto] = (products[i.produto] || 0) + Number(i.quantidade || 0));
        });
        const top = Object.entries(products).sort((a,b)=>b[1]-a[1]).slice(0,5);
        box.innerHTML =
            '<div class="admin-report-grid">' +
            '<div><strong>' + orders.length + '</strong><span>Pedidos registrados</span></div>' +
            '<div><strong>' + units + '</strong><span>Unidades vendidas</span></div>' +
            '<div><strong>' + money(revenue) + '</strong><span>Produtos vendidos</span></div>' +
            '<div><strong>' + money(average) + '</strong><span>Ticket médio</span></div>' +
            '</div>' +
            '<div class="admin-report-details">' +
            '<p><strong>Entrega:</strong> ' + deliveries + ' &nbsp; | &nbsp; <strong>Retirada:</strong> ' + pickups + '</p>' +
            '<p><strong>Pagamentos:</strong> ' + (Object.entries(payments).map(([k,v]) => escapeHTML(k) + ': ' + v).join(' • ') || 'Nenhum pedido ainda') + '</p>' +
            '<p><strong>Mais vendidos:</strong> ' + (top.map(([k,v]) => escapeHTML(k) + ': ' + v).join(' • ') || 'Nenhum produto vendido') + '</p>' +
            '<small>O valor de pedidos com entrega considera somente os produtos e descontos; o frete fica pendente até a confirmação da loja.</small>' +
            '</div>';
    }

    function clearSalesHistory() {
        if (!orderHistory.length) { toast("Ainda não há pedidos registrados."); return; }
        if (!confirm("Apagar o histórico de vendas deste navegador?")) return;
        orderHistory = [];
        saveJSON(ORDER_HISTORY_KEY, orderHistory);
        renderSalesReport();
        toast("Histórico de vendas apagado.");
    }

    async function sendWhatsApp() {
        // Abre a janela imediatamente durante o clique. Isso evita que o navegador
        // bloqueie o WhatsApp depois que o cálculo de endereço termina com await.
        const whatsappWindow = window.open("about:blank", "_blank");
        const name = $("#clientName")?.value.trim();
        if (!name) { toast("Informe seu nome antes de continuar."); $("#clientName")?.focus(); return; }

        const phone = $("#clientPhone")?.value.trim() || "";
        const type = $("#orderType")?.value || "Entrega";
        const addressParts = getDeliveryAddressParts();
        const address = type === "Entrega"
            ? [addressParts.street, addressParts.number, "Sertãozinho - SP"].filter(Boolean).join(", ")
            : (addressParts.full || $("#pickupObservation")?.value.trim() || "");
        const paymentMethod = $("#paymentMethod")?.value || "Pix";
        const paymentTiming = $("#paymentTiming")?.value || "No instante do pedido";
        const paymentLabel = paymentTiming === "No instante do pedido"
            ? "Pagar no instante do pedido"
            : (type === "Retirada" ? "Pagar na retirada" : "Pagar na entrega");
        if (type === "Entrega") {
            if (!addressParts.street || !addressParts.number) { toast("Informe somente a rua e o número do endereço de entrega."); $("#clientStreet")?.focus(); if (whatsappWindow) whatsappWindow.close(); return; }
        }
        if (coupon && !getCoupon(coupon)) {
            coupon = null;
            toast("O cupom não está mais autorizado pela loja.");
            if (whatsappWindow) whatsappWindow.close();
            return;
        }
        const subtotal = cartTotal();
        const discount = couponDiscount(coupon, subtotal);
        const fee = 0;
        const total = Math.max(0, subtotal - discount);

        const agora = new Date();
        const dataPedido = agora.toLocaleDateString("pt-BR");
        const horaPedido = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const orderNumber = nextOrderNumber();

        // Mensagem propositalmente sem emojis para evitar caracteres "�" em alguns ambientes.
        let message = "PURO AMOR DELICIAS CASEIRAS\n";
        message += "================================\n";
        message += orderNumber + "\n";
        message += "NOVO PEDIDO\n";
        message += "Data: " + dataPedido + " | Horario: " + horaPedido + "\n\n";

        message += "DADOS DO CLIENTE\n";
        message += "Nome: " + name + "\n";
        if (phone) message += "Telefone: " + phone + "\n";
        message += "Forma: " + type + "\n";
        message += "Pagamento: " + paymentMethod + " - " + paymentLabel + "\n";
        if (address) {
            message += (type === "Entrega" ? "Endereco: " : "Observacao: ") + address + "\n";
        }
        if (type === "Entrega") {
            message += "Taxa de entrega: A CONFIRMAR PELA LOJA (estimada entre R$ 8,00 e R$ 12,00)\n";
        }

        message += "\nITENS DO PEDIDO\n";
        cart.forEach(item => {
            message += item.quantidade + "x " + item.produto + (item.sabor ? " | Sabor: " + item.sabor : "") + " - " + money(item.preco * item.quantidade) + "\n";
        });

        message += "\nRESUMO DO PEDIDO\n";
        message += "Subtotal: " + money(subtotal) + "\n";
        if (discount) message += "Cupom " + coupon + ": -" + money(discount) + "\n";
        if (type === "Entrega") message += "Frete: A CONFIRMAR PELA LOJA (R$ 8,00 a R$ 12,00)\n";
        message += "--------------------------------\n";
        message += "TOTAL DOS PRODUTOS: " + money(total) + "\n";
        if (type === "Entrega") message += "TOTAL FINAL: A CONFIRMAR APOS DEFINICAO DO FRETE\n";
        message += "================================\n\n";
        message += "Por favor, confirme o pedido e informe o valor exato do frete e o total final.\n";
        message += "Obrigado por escolher a Puro Amor Delicias Caseiras!";

        const order = {
            numero: orderNumber,
            nome: name,
            telefone: phone,
            tipo: type,
            endereco: address,
            formaPagamento: paymentMethod,
            pagamento: paymentLabel,
            itens: cart.map(item => ({ ...item })),
            subtotal,
            desconto: discount,
            taxaEntrega: type === "Entrega" ? null : 0,
            totalProdutos: total,
            total,
            fretePendente: type === "Entrega",
            data: new Date().toISOString()
        };

        recordOrder(order);
        consumeStock(order.itens);
        cart = [];
        saveCart();
        renderCart();

        const whatsappUrl = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(message);
        if (whatsappWindow && !whatsappWindow.closed) {
            whatsappWindow.location.href = whatsappUrl;
        } else {
            // Fallback caso o navegador bloqueie a nova aba.
            window.location.href = whatsappUrl;
        }
        $("#checkoutModal")?.classList.remove("open");
        toast("Pedido preparado para o WhatsApp!");
    }


    /* ===================== PESQUISA ===================== */
    function prepareSearchData() {
        $$(".product-card").forEach(card => {
            const button = $(".order-btn", card);
            if (!button) return;
            card.dataset.productName = button.dataset.product || "";
            card.dataset.productDescription = $("p", card)?.textContent || "";
        });
    }

    function runSearch() {
        const input = $("#productSearch");
        const term = normalize(input?.value || "");
        const activeFilter = $(".filter.active")?.dataset.filter || "todos";
        let visible = 0;

        productCards().forEach(card => {
            const name = card.dataset.productName || "";
            const description = card.dataset.productDescription || "";
            const category = normalize(card.dataset.category || "").replace(/\s+/g, "-");
            const haystack = normalize(name + " " + description + " " + (card.dataset.category || ""));
            const categoryOK = activeFilter === "todos" || category === activeFilter;
            const searchOK = !term || haystack.includes(term);
            const favoriteOK = !favoriteOnly || favorites.includes(name);
            const ok = categoryOK && searchOK && favoriteOK;

            card.style.display = ok ? "" : "none";
            if (ok) visible++;
        });
        let empty = $("#searchEmptyMessage");
        if (!empty) {
            empty = document.createElement("div");
            empty.id = "searchEmptyMessage";
            empty.style.cssText = "display:none;text-align:center;padding:20px;margin:10px 0;border-radius:14px;background:#fff5d8;color:#4b2819;font-weight:800";
            $("#allProducts")?.parentNode?.insertBefore(empty, $("#allProducts"));
        }
        empty.textContent = "Nenhuma delícia encontrada. 🍰";
        empty.style.display = visible ? "none" : "block";
        updateFeaturedVisibility();
    }

    function renderFavoriteButtons() {
        $$(".product-card").forEach(card => {
            const name = card.dataset.productName;
            let button = $(".favorite-btn", card);
            if (!button) {
                button = document.createElement("button");
                button.type = "button";
                button.className = "favorite-btn";
                button.title = "Favoritar";
                const body = $(".product-body", card);
                body?.appendChild(button);
            }
            const active = favorites.includes(name);
            button.textContent = active ? "♥" : "♡";
            button.classList.toggle("is-favorite", active);
            button.dataset.favoriteName = name;
        });
        const count = $("#favoritesCount");
        if (count) count.textContent = favorites.length;
    }

    /* ===================== DETALHES ===================== */
    function showDetails(card) {
        const button = $(".order-btn", card);
        const name = button?.dataset.product || "Produto";
        const price = button?.dataset.price || "0";
        const description = $("p", card)?.textContent.trim() || "Delícia preparada com carinho.";
        const productInfo = getProduct(name);
        let modal = $("#detailsModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "detailsModal";
            modal.className = "details-modal";
            modal.innerHTML = '<div class="modal-card"><button type="button" class="modal-close" data-close="detailsModal">×</button><div id="detailContent"></div></div>';
            document.body.appendChild(modal);
        }
        const available = isAvailable(name);
        const flavors = productFlavors(name);
        $("#detailContent", modal).innerHTML = '<span class="eyebrow">PURO AMOR</span><h2>' + escapeHTML(name) + '</h2><p>' + escapeHTML(description) + '</p>' + (productInfo.weight ? '<div class="product-weight detail-weight">Peso: ' + escapeHTML(productInfo.weight) + '</div>' : '') + (flavors.length ? '<div class="product-flavors detail-flavors"><strong>Sabores:</strong> ' + escapeHTML(flavors.join(", ")) + '</div>' : '') + '<div class="detail-price">' + money(price) + '</div>' + (available ? '<button type="button" class="primary-modal-btn" data-detail-add>Adicionar ao carrinho 🛒</button>' : '<div class="unavailable-message">😔 Produto indisponível no momento.</div>');
        modal.classList.add("open");
        $("[data-detail-add]", modal)?.addEventListener("click", () => {
            modal.classList.remove("open");
            if (productFlavors(name).length) openFlavorSelector(name, price);
            else { addToCart(name, price); openCart(); }
        });
    }

    /* ===================== CHATBOT ===================== */
    function openChat() { $("#chatbot")?.classList.add("open"); $("#chatInput")?.focus(); }
    function closeChat() { $("#chatbot")?.classList.remove("open"); }
    const answers = [
        [["oi","ola","olá","bom dia","boa tarde","boa noite"], "Olá! 💗 Bem-vindo(a) à Puro Amor Delícias Caseiras!"],
        [["cardapio","cardápio","menu"], "📖 Confira nossas delícias no cardápio acima."],
        [["preco","preço","valor"], "💰 Os preços aparecem em cada produto do cardápio."],
        [["entrega","delivery"], "🛵 Consulte as condições de entrega no momento do pedido."],
        [["pedido","comprar","carrinho"], "🛒 Clique em Pedir, confira o carrinho e finalize pelo WhatsApp."],
        [["instagram"], "📸 Instagram: @puroamor_deliciascaseiras"],
        [["ifood"], "🛵 O botão do iFood está na área de contato."]
    ];
    function chatAnswer(text) {
        const t = normalize(text);
        for (const [words, answer] of answers) if (words.some(w => t.includes(normalize(w)))) return answer;
        return "Posso ajudar com cardápio, preços, entrega, pedido, Instagram ou iFood. 😊";
    }

    /* ===================== EVENTOS ÚNICOS ===================== */
    $("#cartFab")?.addEventListener("click", openCart);
    $("#cartClose")?.addEventListener("click", closeCart);
    $("#cartOverlay")?.addEventListener("click", closeCart);
    $("#cartCheckout")?.addEventListener("click", openCheckout);
    document.addEventListener("input", event => {
        if (["clientStreet", "clientNumber"].includes(event.target.id)) {
            deliveryFee = 0;
            getDeliveryAddressParts();
            if (($('#orderType')?.value || "Entrega") === "Entrega") {
                updateDeliveryMessage("Endereço alterado. O frete será confirmado pela loja após o envio do pedido.");
                renderCheckout();
            }
        }
    });
    document.addEventListener("change", event => {
        if (event.target.id === "orderType") {
            deliveryFee = 0;
            updateCheckoutAddressFields();
            if (event.target.value === "Retirada") {
                updateDeliveryMessage("Retirada no local: sem taxa de entrega.", true);
                renderCheckout();
            } else {
                calculateDeliveryFee();
            }
        }
        if (event.target.id === "paymentTiming") renderCheckout();
    });
    document.addEventListener("blur", event => {
        if (["clientStreet", "clientNumber"].includes(event.target.id)) {
            deliveryFee = 0;
            updateDeliveryMessage("Digite a rua e o número. O frete será confirmado pela loja.");
            renderCheckout();
        }
    }, true);
    $("#cartClear")?.addEventListener("click", () => {
        if (!cart.length) return;
        if (confirm("Deseja realmente limpar o carrinho?")) { cart = []; saveCart(); renderCart(); }
    });
    $("#adminTrigger")?.addEventListener("click", openAdmin);

    document.addEventListener("click", function (event) {
        const filterButton = event.target.closest?.(".filter");
        if (filterButton) {
            $$(".filter").forEach(x => x.classList.remove("active"));
            filterButton.classList.add("active");
            runSearch();
            return;
        }

        const orderButton = event.target.closest?.(".order-btn");
        if (orderButton) {
            event.preventDefault();
            event.stopPropagation();
            addToCart(orderButton.dataset.product, orderButton.dataset.price);
            if (!productFlavors(orderButton.dataset.product).length) openCart();
            return;
        }

        const action = event.target.closest?.("[data-cart]");
        if (action) { changeCart(Number(action.dataset.index), action.dataset.cart); return; }

        if (event.target.closest?.("[data-cart-empty]")) {
            closeCart();
            $("#cardapio")?.scrollIntoView({ behavior: "smooth" });
            return;
        }

        const favorite = event.target.closest?.(".favorite-btn");
        if (favorite) {
            const name = favorite.dataset.favoriteName;
            if (favorites.includes(name)) favorites = favorites.filter(x => x !== name);
            else favorites.push(name);
            saveJSON(FAV_KEY, favorites);
            renderFavoriteButtons();
            runSearch();
            return;
        }

        const detail = event.target.closest?.(".product-details-btn");
        if (detail) { showDetails(detail.closest(".product-card")); return; }

        const close = event.target.closest?.("[data-close]");
        if (close) { $("#" + close.dataset.close)?.classList.remove("open"); return; }

        if (event.target.id === "couponApply") {
            const code = normalizeCouponCode($("#couponInput")?.value);
            const msg = $("#couponMessage");
            const item = getCoupon(code);
            if (item) {
                coupon = item.code;
                const text = item.type === "fixed" ? money(item.value) : Number(item.value) + "%";
                msg.textContent = "Cupom autorizado aplicado: " + item.code + " (" + text + ").";
            } else {
                coupon = null;
                msg.textContent = "Cupom inválido ou não autorizado pela loja.";
            }
            renderCheckout();
            return;
        }

        if (event.target.id === "addCategoryBtn") { addCategory(); return; }
        const renameCategoryBtn = event.target.closest?.("[data-rename-category]");
        if (renameCategoryBtn) { renameCategory(Number(renameCategoryBtn.dataset.renameCategory)); return; }
        const removeCategoryBtn = event.target.closest?.("[data-remove-category]");
        if (removeCategoryBtn) { removeCategory(Number(removeCategoryBtn.dataset.removeCategory)); return; }

        if (event.target.id === "addAuthorizedCouponBtn") { addAuthorizedCoupon(); return; }
        const toggleCouponBtn = event.target.closest?.("[data-toggle-coupon]");
        if (toggleCouponBtn) { toggleCoupon(toggleCouponBtn.dataset.toggleCoupon); return; }
        const removeCouponBtn = event.target.closest?.("[data-remove-coupon]");
        if (removeCouponBtn) { removeCoupon(removeCouponBtn.dataset.removeCoupon); return; }

        if (event.target.id === "sendWhatsapp") { sendWhatsApp(); return; }
        if (event.target.id === "refreshSalesReport") { renderSalesReport(); toast("Relatório atualizado."); return; }
        if (event.target.id === "clearSalesHistory") { clearSalesHistory(); return; }

        // O botão de novo produto possui seu próprio listener.
        // Mantemos o restante dos eventos do painel neste delegado.

        const removeProductButton = event.target.closest?.("[data-remove-product]");
        if (removeProductButton) { removeProduct(removeProductButton.dataset.removeProduct); return; }

        const restoreProductButton = event.target.closest?.("[data-restore-product]");
        if (restoreProductButton) { restoreProduct(restoreProductButton.dataset.restoreProduct); return; }

        const saveProduct = event.target.closest?.("[data-save-product]");
        if (saveProduct) { saveProductEditor(saveProduct.dataset.saveProduct); return; }

        const imageFile = event.target.closest?.("[data-edit-image-file]");
        if (imageFile) return;

        const stockToggle = event.target.closest?.("[data-toggle-stock]");
        if (stockToggle) {
            toggleAvailability(stockToggle.dataset.toggleStock);
            return;
        }

        if (event.target.id === "favoritesFilter") {
            favoriteOnly = !favoriteOnly;
            event.target.classList.toggle("active", favoriteOnly);
            runSearch();
            return;
        }
    });

    document.addEventListener("change", function (event) {
        const imageFile = event.target.closest?.("[data-edit-image-file]");
        if (imageFile) loadImageFile(imageFile);
    });

    $("#productSearch")?.addEventListener("input", runSearch);
    $("#productSearch")?.addEventListener("search", runSearch);

    $("#chatFab")?.addEventListener("click", () => $("#chatbot")?.classList.contains("open") ? closeChat() : openChat());
    $("#closeChat")?.addEventListener("click", closeChat);
    $("#chatForm")?.addEventListener("submit", function (event) {
        event.preventDefault();
        const input = $("#chatInput");
        const text = input?.value.trim();
        if (!text) return;
        const messages = $("#chatMessages");
        const add = (value, type) => { if (!messages) return; const div = document.createElement("div"); div.className = "message " + type; div.textContent = value; messages.appendChild(div); messages.scrollTop = messages.scrollHeight; };
        input.value = "";
        add(text, "user");
        setTimeout(() => add(chatAnswer(text), "bot"), 250);
    });

    $$(".quick-options button").forEach(button => button.addEventListener("click", () => {
        const text = button.dataset.question || button.textContent;
        const messages = $("#chatMessages");
        if (!messages) return;
        const add = (value, type) => { const div = document.createElement("div"); div.className = "message " + type; div.textContent = value; messages.appendChild(div); messages.scrollTop = messages.scrollHeight; };
        add(text, "user");
        setTimeout(() => add(chatAnswer(text), "bot"), 250);
    }));

    $$("[data-ifood-link]").forEach(a => a.href = IFOOD);
    $("#heroChat")?.addEventListener("click", openChat);
    $("#contactChat")?.addEventListener("click", openChat);


    document.addEventListener("keydown", event => { if (event.key === "Escape") { closeCart(); closeChat(); $$(".details-modal,.checkout-modal,.admin-modal").forEach(m => m.classList.remove("open")); } });

    /* adiciona detalhes e favoritos aos produtos sem alterar o tema */
    // Produtos cadastrados pelo dono também fazem parte do cardápio público.
    // Primeiro tentamos buscar as alterações no Supabase; se falhar, o site
    // continua funcionando com os dados salvos neste navegador.
    loadProductsOnline().finally(() => {
    renderCustomProducts();
    applyRemovedProducts();
    prepareSearchData();
    $$(".product-card").forEach(card => {
        if (!$(".product-details-btn", card)) {
            const body = $(".product-body", card);
            if (body) { const b = document.createElement("button"); b.type = "button"; b.className = "product-details-btn"; b.textContent = "Ver detalhes"; body.appendChild(b); }
        }
    });
    renderFavoriteButtons();
    renderAvailability();
    renderFeatured();
    renderCart();
    runSearch();

    console.log("PURO AMOR 2026.09.22 — sistema carregado" + (supabaseOnline ? " + Supabase online" : " + modo local"));
    });
});

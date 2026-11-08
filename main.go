// 我的导航 — Go 后端（标准库，无第三方依赖）
//
// 服务内容：
//   - 静态前端：web/ 目录（首页、搜索、时钟、分类、链接方块）
//   - JSON API：/api/bookmarks（查）、增删改链接与分类（管理员）
//   - 数据持久化：本地 data/data.json（无外部数据库）
//   - 管理员登录：用户名/密码来自环境变量 NAV_ADMIN_USER /
//     NAV_ADMIN_PASSWORD，默认 admin / change-me，部署后必须改掉。
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ---------- 数据模型 ----------

type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Order int    `json:"order"`
}

type Bookmark struct {
	ID         string `json:"id"`
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	URL        string `json:"url"`
}

type Store struct {
	Categories []Category `json:"categories"`
	Bookmarks  []Bookmark `json:"bookmarks"`
}

// ---------- 初始数据：与旧版静态页完全一致的 21 个链接 ----------

func seedStore() Store {
	cats := []Category{
		{ID: "daily", Name: "Daily", Order: 1},
		{ID: "speedtest", Name: "SpeedTest", Order: 2},
		{ID: "common", Name: "常用", Order: 3},
		{ID: "ipdns", Name: "IP&DNS", Order: 4},
		{ID: "ai", Name: "AI & 智能", Order: 5},
		{ID: "vps", Name: "VPS/云服务器", Order: 6},
		{ID: "mail", Name: "邮箱", Order: 7},
		{ID: "domain", Name: "域名", Order: 8},
		{ID: "other", Name: "其他导航", Order: 9},
	}
	marks := []Bookmark{
		{ID: "b01", CategoryID: "daily", Name: "NodeSeek", URL: "https://www.nodeseek.com"},
		{ID: "b02", CategoryID: "daily", Name: "cloudflare", URL: "https://www.cloudflare.com"},
		{ID: "b03", CategoryID: "daily", Name: "ITDOG", URL: "https://www.itdog.cn"},
		{ID: "b04", CategoryID: "daily", Name: "komari探针", URL: "https://komari.greystack.dev"},
		{ID: "b05", CategoryID: "speedtest", Name: "speedtest", URL: "https://www.speedtest.net"},
		{ID: "b06", CategoryID: "speedtest", Name: "Fast", URL: "https://fast.com"},
		{ID: "b07", CategoryID: "speedtest", Name: "cf测速", URL: "https://speed.cloudflare.com"},
		{ID: "b08", CategoryID: "speedtest", Name: "LibreSpeed", URL: "https://librespeed.org"},
		{ID: "b09", CategoryID: "speedtest", Name: "MeasurementLab", URL: "https://speed.measurementlab.net"},
		{ID: "b10", CategoryID: "common", Name: "GitHub", URL: "https://github.com"},
		{ID: "b11", CategoryID: "common", Name: "Google", URL: "https://www.google.com"},
		{ID: "b12", CategoryID: "ipdns", Name: "IP查询", URL: "https://ipinfo.io"},
		{ID: "b13", CategoryID: "ai", Name: "ChatGPT", URL: "https://chatgpt.com"},
		{ID: "b14", CategoryID: "ai", Name: "Claude", URL: "https://claude.ai"},
		{ID: "b15", CategoryID: "ai", Name: "Gemini", URL: "https://gemini.google.com"},
		{ID: "b16", CategoryID: "vps", Name: "V.PS", URL: "https://v.ps"},
		{ID: "b17", CategoryID: "vps", Name: "DMIT", URL: "https://dmit.io"},
		{ID: "b18", CategoryID: "vps", Name: "GoMami", URL: "https://gomami.io"},
		{ID: "b19", CategoryID: "mail", Name: "Gmail", URL: "https://mail.google.com"},
		{ID: "b20", CategoryID: "mail", Name: "Outlook", URL: "https://outlook.com"},
		{ID: "b21", CategoryID: "other", Name: "XiaoWork Nav", URL: "https://nav.xiaoworks.com"},
	}
	return Store{Categories: cats, Bookmarks: marks}
}

// ---------- 本地 JSON 存储（互斥锁 + 原子写入） ----------

type DB struct {
	mu   sync.Mutex
	path string
	data Store
}

func newDB(path string) (*DB, error) {
	db := &DB{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			db.data = seedStore()
			if err := db.saveLocked(); err != nil {
				return nil, err
			}
			return db, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, &db.data); err != nil {
		return nil, fmt.Errorf("data.json 损坏，无法解析：%w", err)
	}
	if db.data.Categories == nil {
		db.data.Categories = []Category{}
	}
	if db.data.Bookmarks == nil {
		db.data.Bookmarks = []Bookmark{}
	}
	return db, nil
}

// saveLocked 调用方必须已持有 db.mu。
func (db *DB) saveLocked() error {
	raw, err := json.MarshalIndent(db.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := db.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, db.path)
}

func (db *DB) snapshot() Store {
	db.mu.Lock()
	defer db.mu.Unlock()
	out := Store{
		Categories: append([]Category(nil), db.data.Categories...),
		Bookmarks:  append([]Bookmark(nil), db.data.Bookmarks...),
	}
	sort.Slice(out.Categories, func(i, j int) bool { return out.Categories[i].Order < out.Categories[j].Order })
	return out
}

func (db *DB) categoryExists(id string) bool {
	for _, c := range db.data.Categories {
		if c.ID == id {
			return true
		}
	}
	return false
}

// ---------- 管理员登录（会话 Cookie） ----------

var (
	adminUser = "admin"
	adminPass = "change-me"
	// token -> 过期时间
	sessions   = map[string]time.Time{}
	sessionsMu sync.Mutex
)

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hash(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

func checkCredentials(user, pass string) bool {
	uOK := subtle.ConstantTimeCompare(hash(user), hash(adminUser)) == 1
	pOK := subtle.ConstantTimeCompare(hash(pass), hash(adminPass)) == 1
	return uOK && pOK
}

func isLoggedIn(r *http.Request) bool {
	c, err := r.Cookie("nav_session")
	if err != nil || c.Value == "" {
		return false
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	exp, ok := sessions[c.Value]
	if !ok || time.Now().After(exp) {
		delete(sessions, c.Value)
		return false
	}
	return true
}

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !isLoggedIn(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "需要先登录管理员"})
		return false
	}
	return true
}

// ---------- 小工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func validURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

// ---------- API 处理 ----------

var db *DB

func handleBookmarks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, db.snapshot())
	case http.MethodPost:
		if !requireAdmin(w, r) {
			return
		}
		var in Bookmark
		if err := decodeJSON(r, &in); err != nil {
			writeError(w, http.StatusBadRequest, "请求体不是合法 JSON")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.URL = strings.TrimSpace(in.URL)
		if in.Name == "" || !validURL(in.URL) {
			writeError(w, http.StatusBadRequest, "名字不能为空，网址必须以 http:// 或 https:// 开头")
			return
		}
		db.mu.Lock()
		defer db.mu.Unlock()
		if !db.categoryExists(in.CategoryID) {
			writeError(w, http.StatusBadRequest, "分类不存在")
			return
		}
		in.ID = "b" + newToken()[:8]
		db.data.Bookmarks = append(db.data.Bookmarks, in)
		if err := db.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusCreated, in)
	default:
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
	}
}

func handleBookmarkByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/bookmarks/")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusNotFound, "链接不存在")
		return
	}
	if !requireAdmin(w, r) {
		return
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	idx := -1
	for i, b := range db.data.Bookmarks {
		if b.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "链接不存在")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var in Bookmark
		if err := decodeJSON(r, &in); err != nil {
			writeError(w, http.StatusBadRequest, "请求体不是合法 JSON")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		in.URL = strings.TrimSpace(in.URL)
		if in.Name == "" || !validURL(in.URL) {
			writeError(w, http.StatusBadRequest, "名字不能为空，网址必须以 http:// 或 https:// 开头")
			return
		}
		if !db.categoryExists(in.CategoryID) {
			writeError(w, http.StatusBadRequest, "分类不存在")
			return
		}
		in.ID = id
		db.data.Bookmarks[idx] = in
		if err := db.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusOK, in)
	case http.MethodDelete:
		db.data.Bookmarks = append(db.data.Bookmarks[:idx], db.data.Bookmarks[idx+1:]...)
		if err := db.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
	}
}

func handleCategories(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
		return
	}
	if !requireAdmin(w, r) {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeError(w, http.StatusBadRequest, "分类名不能为空")
		return
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	maxOrder := 0
	for _, c := range db.data.Categories {
		if c.Order > maxOrder {
			maxOrder = c.Order
		}
	}
	cat := Category{ID: "c" + newToken()[:8], Name: in.Name, Order: maxOrder + 1}
	db.data.Categories = append(db.data.Categories, cat)
	if err := db.saveLocked(); err != nil {
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusCreated, cat)
}

func handleCategoryByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/categories/")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusNotFound, "分类不存在")
		return
	}
	if !requireAdmin(w, r) {
		return
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	idx := -1
	for i, c := range db.data.Categories {
		if c.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "分类不存在")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var in struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(r, &in); err != nil {
			writeError(w, http.StatusBadRequest, "请求体不是合法 JSON")
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" {
			writeError(w, http.StatusBadRequest, "分类名不能为空")
			return
		}
		db.data.Categories[idx].Name = in.Name
		if err := db.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusOK, db.data.Categories[idx])
	case http.MethodDelete:
		for _, b := range db.data.Bookmarks {
			if b.CategoryID == id {
				writeError(w, http.StatusBadRequest, "分类里还有链接，先移走或删掉链接再删分类")
				return
			}
		}
		db.data.Categories = append(db.data.Categories[:idx], db.data.Categories[idx+1:]...)
		if err := db.saveLocked(); err != nil {
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
	}
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "请求体不是合法 JSON")
		return
	}
	if !checkCredentials(in.Username, in.Password) {
		writeError(w, http.StatusUnauthorized, "用户名或密码不对")
		return
	}
	token := newToken()
	sessionsMu.Lock()
	sessions[token] = time.Now().Add(30 * 24 * time.Hour)
	sessionsMu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     "nav_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 3600,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "username": in.Username})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "方法不支持")
		return
	}
	if c, err := r.Cookie("nav_session"); err == nil {
		sessionsMu.Lock()
		delete(sessions, c.Value)
		sessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "nav_session", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"loggedIn": isLoggedIn(r)})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprint(w, "ok")
}

// ---------- 启动 ----------

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	adminUser = getenv("NAV_ADMIN_USER", "admin")
	adminPass = getenv("NAV_ADMIN_PASSWORD", "change-me")
	if adminPass == "change-me" {
		log.Println("警告：正在使用默认管理员密码 change-me，部署后请马上用环境变量 NAV_ADMIN_PASSWORD 改掉。")
	}
	dataPath := getenv("NAV_DATA_FILE", filepath.Join("data", "data.json"))
	var err error
	db, err = newDB(dataPath)
	if err != nil {
		log.Fatalf("加载数据失败：%v", err)
	}

	webDir := getenv("NAV_WEB_DIR", "web")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/bookmarks", handleBookmarks)
	mux.HandleFunc("/api/bookmarks/", handleBookmarkByID)
	mux.HandleFunc("/api/categories", handleCategories)
	mux.HandleFunc("/api/categories/", handleCategoryByID)
	mux.HandleFunc("/api/login", handleLogin)
	mux.HandleFunc("/api/logout", handleLogout)
	mux.HandleFunc("/api/me", handleMe)
	mux.HandleFunc("/healthz", handleHealth)
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	port := getenv("PORT", "8080")
	log.Printf("导航站已启动：http://127.0.0.1:%s/  数据文件：%s", port, dataPath)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

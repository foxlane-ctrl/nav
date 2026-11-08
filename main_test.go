package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	d, err := newDB(filepath.Join(dir, "data.json"))
	if err != nil {
		t.Fatalf("newDB: %v", err)
	}
	db = d
	adminUser = "admin"
	adminPass = "change-me"
	sessions = map[string]time.Time{}
}

func TestSeedHas21Bookmarks(t *testing.T) {
	s := seedStore()
	if len(s.Bookmarks) != 21 {
		t.Fatalf("seed 链接数 = %d，想要 21", len(s.Bookmarks))
	}
	if len(s.Categories) != 9 {
		t.Fatalf("seed 分类数 = %d，想要 9", len(s.Categories))
	}
	seen := map[string]bool{}
	for _, b := range s.Bookmarks {
		if b.Name == "" || !strings.HasPrefix(b.URL, "https://") {
			t.Fatalf("链接不合法：%+v", b)
		}
		if seen[b.URL] {
			t.Fatalf("重复网址：%s", b.URL)
		}
		seen[b.URL] = true
	}
}

func TestStoreSaveLoadRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	d, err := newDB(path)
	if err != nil {
		t.Fatalf("newDB: %v", err)
	}
	d.mu.Lock()
	d.data.Bookmarks = append(d.data.Bookmarks, Bookmark{ID: "test1", CategoryID: "daily", Name: "测试", URL: "https://example.com"})
	if err := d.saveLocked(); err != nil {
		t.Fatalf("save: %v", err)
	}
	d.mu.Unlock()

	d2, err := newDB(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	found := false
	for _, b := range d2.data.Bookmarks {
		if b.ID == "test1" {
			found = true
		}
	}
	if !found {
		t.Fatal("重新加载后找不到保存的链接")
	}
}

func TestLoginWrongPasswordRejected(t *testing.T) {
	setupTestDB(t)
	body := bytes.NewBufferString(`{"username":"admin","password":"wrong"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/login", body)
	w := httptest.NewRecorder()
	handleLogin(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("错误密码返回 %d，想要 401", w.Code)
	}
}

func TestLoginAndAdminCRUD(t *testing.T) {
	setupTestDB(t)

	// 登录
	body := bytes.NewBufferString(`{"username":"admin","password":"change-me"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/login", body)
	w := httptest.NewRecorder()
	handleLogin(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("登录返回 %d，想要 200：%s", w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()
	if len(cookie) == 0 {
		t.Fatal("登录没有发回 Cookie")
	}

	// 未登录不能加链接
	req = httptest.NewRequest(http.MethodPost, "/api/bookmarks", bytes.NewBufferString(`{"name":"X","url":"https://example.com","categoryId":"daily"}`))
	w = httptest.NewRecorder()
	handleBookmarks(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("未登录加链接返回 %d，想要 401", w.Code)
	}

	// 登录后加链接
	req = httptest.NewRequest(http.MethodPost, "/api/bookmarks", bytes.NewBufferString(`{"name":"X","url":"https://example.com","categoryId":"daily"}`))
	req.AddCookie(cookie[0])
	w = httptest.NewRecorder()
	handleBookmarks(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("登录后加链接返回 %d，想要 201：%s", w.Code, w.Body.String())
	}
	var created Bookmark
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("解析返回：%v", err)
	}

	// GET 列表里能看到新链接（21 + 1）
	req = httptest.NewRequest(http.MethodGet, "/api/bookmarks", nil)
	w = httptest.NewRecorder()
	handleBookmarks(w, req)
	var snap Store
	if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
		t.Fatalf("解析列表：%v", err)
	}
	if len(snap.Bookmarks) != 22 {
		t.Fatalf("列表链接数 = %d，想要 22", len(snap.Bookmarks))
	}

	// 删除
	req = httptest.NewRequest(http.MethodDelete, "/api/bookmarks/"+created.ID, nil)
	req.AddCookie(cookie[0])
	w = httptest.NewRecorder()
	handleBookmarkByID(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("删除返回 %d，想要 200：%s", w.Code, w.Body.String())
	}

	// data.json 真的写到磁盘了
	raw, err := os.ReadFile(db.path)
	if err != nil {
		t.Fatalf("读 data.json：%v", err)
	}
	var onDisk Store
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("解析磁盘数据：%v", err)
	}
	if len(onDisk.Bookmarks) != 21 {
		t.Fatalf("磁盘链接数 = %d，想要 21", len(onDisk.Bookmarks))
	}
}

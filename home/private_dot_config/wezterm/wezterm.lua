-- WezTerm is the outer terminal. On the Macs, Herdr can own tabs, panes and
-- workspaces inside it. Machine-specific choices live in local.lua next to this
-- file (see the end of this file), so this one stays identical everywhere.

local wezterm = require 'wezterm'
local act = wezterm.action

local config = wezterm.config_builder()
local is_windows = wezterm.target_triple:find('windows') ~= nil
local is_mac = wezterm.target_triple:find('darwin') ~= nil

local start_herdr = wezterm.home_dir .. '/.config/wezterm/start-herdr'
-- On Windows, prefer PowerShell 7 when it is installed, else the built-in Windows PowerShell.
local function windows_shell()
  for dir in (os.getenv('PATH') or ''):gmatch('[^;]+') do
    if #wezterm.glob(dir .. '\\pwsh.exe') > 0 then
      return { 'pwsh.exe', '-NoLogo' }
    end
  end
  return { 'powershell.exe', '-NoLogo' }
end
local login_shell = is_windows and windows_shell() or { '/bin/zsh', '-l' }

config.default_prog = login_shell
config.term = 'xterm-256color'

config.font = wezterm.font_with_fallback {
  'JetBrains Mono',
  is_windows and 'Cascadia Mono' or 'Menlo',
}
config.font_size = is_windows and 11 or 14
config.line_height = 1.08

config.colors = {
  foreground = '#dce7f7',
  background = '#07111f',
  cursor_bg = '#8bdcff',
  cursor_fg = '#07111f',
  selection_bg = '#24466f',
  selection_fg = '#ffffff',
}

-- Windows draws minimize/maximize/close only as integrated buttons, which live in the tab bar.
config.window_decorations = is_windows and 'INTEGRATED_BUTTONS|RESIZE' or 'RESIZE'
config.window_background_opacity = 0.94
if is_mac then
  config.macos_window_background_blur = 24
end
config.window_padding = { left = 14, right = 14, top = 12, bottom = 12 }
config.initial_cols = 132
config.initial_rows = 38
config.adjust_window_size_when_changing_font_size = false

config.use_fancy_tab_bar = true
config.hide_tab_bar_if_only_one_tab = not is_windows
config.scrollback_lines = 10000
config.audible_bell = 'Disabled'
config.notification_handling = 'SuppressFromFocusedWindow'

-- Left Option acts as Alt for terminal shortcuts; Right Option still composes characters.
config.send_composed_key_when_left_alt_is_pressed = false
config.send_composed_key_when_right_alt_is_pressed = true

if is_windows then
  -- Herdr's Windows client garbles pastes that arrive as win32-input-mode key records.
  config.allow_win32_input_mode = false
end

-- Outer-terminal controls use Command (macOS) or Ctrl+Shift (elsewhere); Ctrl-b belongs to Herdr.
local mod = is_mac and 'CMD|SHIFT' or 'CTRL|SHIFT'

config.launch_menu = {
  { label = 'Login shell', args = login_shell },
}
if not is_windows then
  table.insert(config.launch_menu, 1, { label = 'Herdr', args = { start_herdr } })
end

config.keys = {
  { key = 'l', mods = mod, action = act.ShowLauncher },
  { key = 's', mods = mod, action = act.SpawnCommandInNewWindow { args = login_shell } },
}
if is_windows then
  table.insert(config.keys, { key = 'v', mods = 'CTRL', action = act.PasteFrom 'Clipboard' })
else
  table.insert(config.keys, { key = 'n', mods = mod, action = act.SpawnCommandInNewWindow { args = { start_herdr } } })
end

-- Hosts reachable over SSH, e.g. the Mac mini from Windows. Filled in by local.lua.
config.ssh_domains = {}

-- local.lua returns a function that receives the config and a table of helpers:
--   return function(config, h)
--     h.use_herdr()                        -- Herdr in every new window, native tabs off
--     h.ssh('mini', 'user@host.local') -- adds an SSH domain and a launcher entry
--   end
local helpers = {
  use_herdr = function()
    if is_windows then
      wezterm.log_warn('use_herdr() is ignored on Windows; Herdr runs on the Macs')
      return
    end
    config.default_prog = { start_herdr }
    config.enable_tab_bar = false
    table.insert(config.keys, { key = 't', mods = 'CMD', action = act.DisableDefaultAssignment })
    table.insert(config.keys, { key = 'T', mods = 'CMD|SHIFT', action = act.DisableDefaultAssignment })
  end,
  ssh = function(name, remote_address)
    table.insert(config.ssh_domains, { name = name, remote_address = remote_address, multiplexing = 'None' })
    table.insert(config.launch_menu, { label = 'SSH: ' .. name, domain = { DomainName = name } })
  end,
}

local ok, customize = pcall(require, 'local')
if ok and type(customize) == 'function' then
  local applied, err = pcall(customize, config, helpers)
  if not applied then
    wezterm.log_error('local.lua failed: ' .. tostring(err))
  end
elseif not ok and not tostring(customize):find("module 'local' not found", 1, true) then
  wezterm.log_error('local.lua failed: ' .. tostring(customize))
end

return config

--!strict
-- apps/tern-plugin/window.luau
-- Window half for OMP Toolkit Tern plugin. Exposes 4 palette commands.

local function runHelper(cx: any, action: string, target_cwd: string?)
	local host_ok, host = pcall(function()
		return cx.hosts:current()
	end)
	if not host_ok or not host or host.kind ~= "local" then
		cx:toast("error", "OMP Toolkit supports local Tern sessions only.")
		return
	end

	local session_ok, session = pcall(function()
		return cx.sessions:current()
	end)
	if not session_ok or not session or not session.id then
		cx:toast("error", "Cannot identify current Tern session.")
		return
	end

	local key_ok, window_key = pcall(function()
		return cx:window_key()
	end)
	if not key_ok or not window_key then
		window_key = ""
	end

	local bun = tern.getenv("BUN_BIN")
	if not bun or bun == "" then
		if tern.runtime.os == "windows" then
			bun = "bun.exe"
		else
			bun = "bun"
		end
	end

	local sep = "/"
	if tern.runtime.os == "windows" and tern.plugin.dir:find("\\") then
		sep = "\\"
	end
	local runner_path = tern.plugin.dir .. sep .. "runner.ts"
	local argv = {
		bun,
		runner_path,
		"open",
		action,
		"--window=" .. window_key,
		"--session=" .. tostring(session.id),
	}
	if target_cwd and target_cwd ~= "" then
		table.insert(argv, "--cwd=" .. target_cwd)
	end

	local run_ok, err = pcall(function()
		tern.process.run(argv, { timeout_ms = 15000 }, function(result, fresh_cx)
			if not fresh_cx then
				return
			end
			if result.timed_out then
				fresh_cx:toast("error", "OMP Toolkit helper timed out after 15s.")
				return
			end
			if result.status ~= 0 then
				local msg = (result.stderr ~= "" and result.stderr)
					or (result.stdout ~= "" and result.stdout)
					or ("helper exited with code " .. tostring(result.status))
				fresh_cx:toast("error", msg)
				return
			end
			local decode_ok, data = pcall(function()
				return tern.json.decode(result.stdout)
			end)
			if not decode_ok or not data or data.ok ~= true then
				local fail_msg = (data and data.message) or "Failed to open OMP tool."
				fresh_cx:toast("error", fail_msg)
				return
			end
		end)
	end)

	if not run_ok then
		cx:toast("error", "Failed to start runner helper: " .. tostring(err))
	end
end

-- 1. OMP: Open or focus session
tern.command({
	id = "open-session",
	title = "OMP: Open or focus session",
	group = "OMP Toolkit",
	icon = "sparkle",
	run = function(cx)
		local focused_id = cx.session:focused()
		local target_cwd = nil
		if focused_id ~= nil then
			for _, pane in cx.session:panes() do
				if pane.pane == focused_id then
					if pane.cwd and pane.cwd ~= "" then
						target_cwd = pane.cwd
					end
					break
				end
			end
		end

		if not target_cwd then
			cx:toast("error", "Focus a local project terminal before opening OMP.")
			return
		end

		runHelper(cx, "session", target_cwd)
	end,
})

-- 2. OMP: Open or focus usage monitor
tern.command({
	id = "open-monitor",
	title = "OMP: Open or focus usage monitor",
	group = "OMP Toolkit",
	icon = "meter",
	run = function(cx)
		runHelper(cx, "monitor", nil)
	end,
})

-- 3. OMP: Gateway status
tern.command({
	id = "gateway-status",
	title = "OMP: Gateway status",
	group = "OMP Toolkit",
	icon = "server",
	run = function(cx)
		runHelper(cx, "status", nil)
	end,
})

-- 4. OMP: Gateway doctor
tern.command({
	id = "gateway-doctor",
	title = "OMP: Gateway doctor",
	group = "OMP Toolkit",
	icon = "heart",
	run = function(cx)
		runHelper(cx, "doctor", nil)
	end,
})

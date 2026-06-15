import 'package:flutter/material.dart';

import '../api.dart';
import '../push_service.dart';
import '../theme.dart';
import 'shell_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController(text: ApiClient.instance.baseUrl);
  bool _loading = false;
  bool _showServer = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ApiClient.instance.login(_email.text.trim(), _password.text, base: _server.text);
      PushService.instance.onLogin(); // register this device for pushes
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const ShellScreen()),
      );
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 420;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(compact ? 16 : 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
            child: Container(
              decoration: BoxDecoration(
                color: NW.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: NW.border),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.fromLTRB(24, 22, 24, 18),
                    decoration: const BoxDecoration(
                      color: NW.surface1,
                      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                    ),
                    child: Row(
                      children: [
                        const Text('Nex',
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: NW.text, letterSpacing: -1)),
                        const Text('wear',
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: NW.brand, letterSpacing: -1)),
                        const Spacer(),
                        if (!compact)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: NW.factory.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(5),
                            ),
                            child: const Text('NET RAT',
                                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: NW.factory, letterSpacing: 1)),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.all(compact ? 18 : 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('Sign in to Monitor',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: NW.text)),
                        const SizedBox(height: 4),
                        const Text('Enter your console credentials',
                            style: TextStyle(fontSize: 12, color: NW.text3)),
                        const SizedBox(height: 20),
                        TextField(
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          style: const TextStyle(color: NW.text),
                          decoration: const InputDecoration(labelText: 'Email', hintText: 'admin@nexwear.io'),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: _password,
                          obscureText: true,
                          style: const TextStyle(color: NW.text),
                          onSubmitted: (_) => _loading ? null : _submit(),
                          decoration: const InputDecoration(labelText: 'Password'),
                        ),
                        if (_showServer) ...[
                          const SizedBox(height: 14),
                          TextField(
                            controller: _server,
                            style: const TextStyle(color: NW.text, fontFamily: 'Consolas', fontSize: 12),
                            decoration: const InputDecoration(labelText: 'Server URL'),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            onPressed: () => setState(() => _showServer = !_showServer),
                            style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 30)),
                            child: Text(_showServer ? 'Hide server settings' : 'Server settings',
                                style: const TextStyle(fontSize: 12, color: NW.text3)),
                          ),
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: NW.danger.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: NW.danger.withValues(alpha: 0.3)),
                            ),
                            child: Text(_error!, style: const TextStyle(fontSize: 12, color: NW.danger)),
                          ),
                        ],
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _loading ? null : _submit,
                          style: FilledButton.styleFrom(
                            backgroundColor: NW.brand,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                          child: _loading
                              ? const SizedBox(
                                  width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                              : const Text('Sign in', style: TextStyle(fontWeight: FontWeight.w600)),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
    );
  }
}

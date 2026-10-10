"""Remote-only, sequential quality/resource probe; no model downloads or host changes."""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import threading
import time
import urllib.request

NAME = 'test-reality-poc-ollama-1'
GIB = 1024 ** 3


def memory():
    return {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemAvailable:', 'MemFree:'))}


def cgroup():
    identifier = subprocess.check_output(['docker', 'inspect', '-f', '{{.Id}}', NAME], text=True).strip()
    root = Path('/sys/fs/cgroup/system.slice/docker-' + identifier + '.scope')
    if not root.exists():
        raise RuntimeError('Expected Docker cgroup v2 accounting path missing')
    return root


def usage(root):
    stat = dict(line.split() for line in (root / 'memory.stat').read_text().splitlines())
    cpu = dict(line.split() for line in (root / 'cpu.stat').read_text().splitlines())
    current = int((root / 'memory.current').read_text())
    return {'working_set_bytes': current - int(stat.get('inactive_file', 0)), 'cgroup_memory_bytes': current,
            'anonymous_bytes': int(stat['anon']), 'reclaimable_inactive_file_bytes': int(stat.get('inactive_file', 0)),
            'cpu_usage_usec': int(cpu['usage_usec']), 'host_available_bytes': memory()['MemAvailable']}


def healthy():
    state = json.loads(subprocess.check_output(['docker', 'inspect', '-f', '{{json .State}}', NAME], text=True))
    if state['OOMKilled'] or not state['Running']:
        raise RuntimeError('Ollama runtime unsafe: OOM or not running; stop without changing limits')


FORWARD = '''import json,sys,urllib.request
body=sys.stdin.buffer.read()
request=urllib.request.Request('http://ollama:11434/api/generate',data=body,headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=65) as response:
 for line in response:
  sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--requests', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    requests = json.loads(Path(args.requests).read_text())
    root = cgroup()
    report = {'idle_before': usage(root), 'results': []}
    Path(args.output + '.resources.json').write_text(json.dumps(report, indent=2))
    for case in requests:
        if memory()['MemAvailable'] < GIB:
            raise RuntimeError('Less than 1 GiB available RAM: stop, do not increase limits')
        samples, responsiveness, probe_errors = [], [], []
        finished = threading.Event()
        def monitor():
            next_api = 0
            while not finished.is_set():
                samples.append(usage(root))
                if time.monotonic() >= next_api:
                    for port, path in [(18081, '/api/overview'), (18080, '/')]:
                        start = time.monotonic()
                        try:
                            with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=5) as response:
                                assert response.status == 200
                                response.read()
                            responsiveness.append({'port': port, 'seconds': time.monotonic() - start})
                        except Exception as error:
                            probe_errors.append(str(error))
                    next_api = time.monotonic() + 2
                finished.wait(0.25)
        before = usage(root)
        thread = threading.Thread(target=monitor, daemon=True)
        thread.start()
        started = time.monotonic()
        process = subprocess.Popen(['docker', 'exec', '-i', 'test-reality-poc-analysis-1', 'python', '-c', FORWARD], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        process.stdin.write(json.dumps(case['request']).encode())
        process.stdin.close()
        text, first_token, final = '', None, {}
        try:
            for line in process.stdout:
                chunk = json.loads(line)
                if chunk.get('response'):
                    if first_token is None:
                        first_token = time.monotonic() - started
                    text += chunk['response']
                if chunk.get('done'):
                    final = chunk
            code = process.wait(timeout=70)
            if code != 0:
                raise RuntimeError(process.stderr.read().decode())
        finally:
            finished.set()
            thread.join(timeout=6)
        duration = time.monotonic() - started
        after = usage(root)
        healthy()
        assert samples and responsiveness, 'Resource and HTTP probes required'
        assert not probe_errors, ('Backend/frontend responsiveness failed', probe_errors)
        # Docker subtracts inactive file cache: memory.current alone can reach the
        # hard limit through safely reclaimable model file cache, without RSS pressure.
        if min(s['host_available_bytes'] for s in samples) < GIB or max(s['working_set_bytes'] for s in samples) > 0.95 * GIB:
            raise RuntimeError('Memory safety threshold reached; stop without increasing limits')
        final.update({'name': case['name'], 'source': case['source'], 'response': text, 'first_token_seconds': first_token,
                      'wall_seconds': duration, 'average_cpu_cores': (after['cpu_usage_usec'] - before['cpu_usage_usec']) / duration / 1e6,
                      'peak_working_set_bytes': max(s['working_set_bytes'] for s in samples),
                      'peak_cgroup_memory_bytes': max(s['cgroup_memory_bytes'] for s in samples),
                      'minimum_host_available_bytes': min(s['host_available_bytes'] for s in samples),
                      'http_probe_max_seconds': max(p['seconds'] for p in responsiveness), 'http_probes': responsiveness})
        report['results'].append(final)
        report['loaded_after'] = after
        report['average_wall_seconds'] = statistics.mean(r['wall_seconds'] for r in report['results'])
        Path(args.output).write_text(json.dumps(report['results'], ensure_ascii=False, indent=2))
        Path(args.output + '.resources.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps({k: final[k] for k in ['name', 'wall_seconds', 'first_token_seconds', 'average_cpu_cores', 'peak_working_set_bytes', 'minimum_host_available_bytes']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()

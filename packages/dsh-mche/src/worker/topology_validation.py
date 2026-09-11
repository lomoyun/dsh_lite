"""Bounded physical rows and complete series / row-parallel networks, before loading DLL."""
def validate_topology(request, contract):
    g, t, h, c = [request[k] for k in ['general', 'tube', 'header', 'connection']]
    banks = g[1]
    if type(banks) is not int or not 1 <= banks <= contract['maxRows']:
        raise ValueError('BANKNUM must be 1..5')
    if type(h) is not list or not 1 <= len(h) <= banks * contract['maxPassesPerRow']:
        raise ValueError('Pass capacity invalid')
    row_counts, row_nodes = [0] * banks, [[] for _ in range(banks)]
    next_tube, previous_row = 1, 0
    for i, header in enumerate(h):
        if type(header) is not list or len(header) != 4 or any(type(v) is not int for v in header):
            raise ValueError('HeadInf requires four integers')
        start, end, direction, row = header
        if not 0 <= row < banks or row < previous_row or start != next_tube or end < start or direction not in [-1, 1]:
            raise ValueError('HeadInf global range, direction or physical row invalid')
        row_counts[row] += end - start + 1
        row_nodes[row].append(i + 1)
        next_tube, previous_row = end + 1, row
    for row, count in enumerate(row_counts):
        if not 1 <= count <= contract['maxTubesPerRow'] or not 1 <= len(row_nodes[row]) <= contract['maxPassesPerRow']:
            raise ValueError('Row count / pass capacity invalid')
    uniform = len(set(row_counts)) == 1
    if g[9] != int(uniform):
        raise ValueError('BUNITUBE must reflect per-row tube counts')
    active = 1 if uniform else banks
    for row in range(active):
        block = t[row * 14:(row + 1) * 14]
        if block[1] != row_counts[row] or block[0] != 0 or block[5] != 0 or any(block[10:]):
            raise ValueError('Per-row rectangular tube block invalid / tube conservation failed')
        if row and any(block[i] != t[i] for i in range(14) if i != 1):
            raise ValueError('Only shared tube geometry with independent row counts supported')
    if any(t[active * 14:]):
        raise ValueError('Unused tube blocks must be zero')
    size, outlet = len(h) + 2, len(h) + 1
    if type(c) is not list or len(c) != size or any(type(r) is not list or len(r) != size or any(type(v) is not int or v not in [-1, 0, 1] for v in r) for r in c):
        raise ValueError('Connection matrix dimensions / integer entries invalid')
    if any(c[i][i] != 0 or any(c[i][j] != -c[j][i] for j in range(size)) for i in range(size)):
        raise ValueError('Connection must be antisymmetric without self edges')
    forward = [[j for j, v in enumerate(row) if v == 1] for row in c]
    incoming = [[j for j, v in enumerate(row) if v == -1] for row in c]
    if incoming[0] or forward[outlet]:
        raise ValueError('Total inlet / outlet orientation invalid')
    if len(forward[0]) == 1:
        visited, node = set(), 0
        while node != outlet:
            if node in visited or len(forward[node]) != 1:
                raise ValueError('Series cycle or branch invalid')
            visited.add(node)
            node = forward[node][0]
            if len(incoming[node]) != 1:
                raise ValueError('Series merge invalid')
        if len(visited) != size - 1:
            raise ValueError('Series omits a pass')
    else:
        expected = [[0] * size for _ in range(size)]
        for nodes in row_nodes:
            chain = [0] + nodes + [outlet]
            for a, b in zip(chain, chain[1:]):
                expected[a][b], expected[b][a] = 1, -1
        if c != expected:
            raise ValueError('Parallel requires one complete ordered branch per physical row')

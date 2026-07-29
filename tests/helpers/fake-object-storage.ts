import { vi, type Mock } from 'vitest'

/** Los cuatro métodos como mocks. Se tipa así y no como `Partial<ObjectStorage>`
 *  para que el test conserve `.mockResolvedValue()` sobre cada uno. */
type MockedObjectStorage = {
  presignUpload: Mock
  presignDownload: Mock
  head: Mock
  remove: Mock
}

/**
 * `ObjectStorage` falso para inyectar por `deps.storage` y que CI nunca hable
 * con R2.
 *
 * POR QUÉ EXISTE: el literal con los cuatro `vi.fn()` estaba copiado en cuatro
 * archivos de test, y agregar `remove()` a la interfaz obligó a editar los
 * cuatro sólo para meter un mock que ninguno usa. Con esto, el próximo método
 * se agrega en un lugar.
 *
 * Los overrides se mergean encima, así cada test sólo declara lo que le importa
 * (típicamente `head`).
 */
export function fakeObjectStorage(
  overrides: Partial<MockedObjectStorage> = {},
): MockedObjectStorage {
  return {
    presignUpload: vi.fn().mockResolvedValue('https://signed/put'),
    presignDownload: vi.fn().mockResolvedValue('https://signed/get'),
    head: vi.fn().mockResolvedValue({ contentLength: 1000, contentType: 'image/png' }),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
